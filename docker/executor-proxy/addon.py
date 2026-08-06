# TLS-terminating egress filter for the executor sandbox (C6 — closes Case 7).
#
# Threat closed: a build can read the mounted Claude OAuth token and, against the
# allowlisted host api.anthropic.com, drive Anthropic's SERVER-SIDE web_fetch /
# web_search tools with an attacker-chosen URL (exfil past the network allowlist,
# since Anthropic's servers do the fetch), plus hit /v1/files (upload sink) and
# /api/oauth/profile (identity leak). A blind CONNECT tunnel (old tinyproxy) cannot
# see request bodies or headers, so it could not stop this. This addon terminates
# TLS for api.anthropic.com ONLY and filters the decrypted request.
#
# Policy (deny-by-default, fail-closed):
#   1. HOST ALLOWLIST — only ALLOWED_HOSTS may be reached at all (everything else 403).
#   2. INTERCEPT api.anthropic.com ONLY; blind-passthrough every other allowed host
#      (npm registry keeps its real cert — we do NOT MITM it).
#   3. On intercepted api.anthropic.com requests, REJECT (403) any request that:
#        - targets /v1/files (any method)                  -> upload sink
#        - targets /api/oauth/profile                      -> identity leak
#        - declares a web_fetch/web_search server-tool block in the JSON body
#        - carries a web-fetch-* / web-search-* anthropic-beta header
#      Everything else (normal /v1/messages inference, /v1/models, token counting,
#      etc.) passes through UNTOUCHED so Claude Code still authenticates and runs.
#
# This trades the old "proxy holds no secrets / terminates no TLS" property: the proxy
# now sees the token in plaintext. That is the unavoidable cost of inspection and is
# contained to this local, credential-free-image proxy on an internal-only network.

import re
import logging

from mitmproxy import http

logger = logging.getLogger("c6-egress")

# --- 1. Host allowlist (mirror of docker/executor-proxy/allowlist.txt) --------
# Anchored, case-insensitive, exact-host. Deny-by-default: not matched => refused.
ALLOWED_HOSTS = [
    re.compile(r"^api\.anthropic\.com$", re.I),      # Claude API — required to run at all
    re.compile(r"^registry\.npmjs\.org$", re.I),     # npm install (blind passthrough)
]

# Only this host is TLS-intercepted. All other allowed hosts pass through blind.
INTERCEPT_HOST = "api.anthropic.com"

# --- 3. api.anthropic.com request-level policy --------------------------------
BLOCKED_PATH_EXACT = {"/api/oauth/profile"}          # identity leak
BLOCKED_PATH_PREFIX = ("/v1/files",)                 # upload sink (any method, any subpath)

# web_fetch / web_search server-tool block in the JSON body. Matches both the
# "type" form (e.g. "type":"web_fetch_20250910") and the "name" form
# ("name":"web_fetch"), tolerant of whitespace.
_WEB_TOOL_BODY = re.compile(
    r'"(?:type|name)"\s*:\s*"web_(?:fetch|search)(?:_[0-9]+)?"', re.I
)
# web-fetch-* / web-search-* tokens in the anthropic-beta header.
_WEB_TOOL_BETA = re.compile(r"web-(?:fetch|search)", re.I)


def _host_allowed(host: str) -> bool:
    return any(p.match(host or "") for p in ALLOWED_HOSTS)


def _refuse(flow: http.HTTPFlow, why: str, code: int = 403) -> None:
    logger.warning("REFUSED (%s): %s %s", why, flow.request.method, flow.request.pretty_url)
    flow.response = http.Response.make(
        code, b"blocked by executor egress policy: " + why.encode(), {"Content-Type": "text/plain"}
    )


class C6Egress:
    # http_connect fires for every CONNECT tunnel (the normal HTTPS path). Enforce the
    # host allowlist HERE so a disallowed host never even completes a tunnel. For
    # allowed hosts we let the CONNECT proceed; interception is decided in tls_clienthello.
    def http_connect(self, flow: http.HTTPFlow) -> None:
        # CONNECT tunnels to :443 only (parity with the old tinyproxy ConnectPort 443).
        if flow.request.port != 443:
            _refuse(flow, "port not allowed (443 only)")
            return
        if not _host_allowed(flow.request.host):
            _refuse(flow, "host not allowed")

    # tls_clienthello decides interception per-connection. It MUST key on the CONNECT
    # DESTINATION, not the client-supplied SNI: a build could CONNECT api.anthropic.com
    # but lie SNI=registry.npmjs.org to dodge inspection while still reaching the real API.
    # So we intercept whenever the true upstream host is api.anthropic.com, regardless of
    # SNI. Passthrough (no MITM) ONLY when the destination is a different allowed host
    # (npm). Fail-closed: if the destination can't be determined, intercept.
    def tls_clienthello(self, data) -> None:
        dest = None
        try:
            addr = data.context.server.address       # (host, port) of the CONNECT target
            if addr:
                dest = addr[0]
        except Exception:
            dest = None
        sni = data.client_hello.sni
        # Effective host = the true destination; only fall back to SNI if unknown.
        host = dest if dest is not None else sni
        if host is not None and host != INTERCEPT_HOST:
            data.ignore_connection = True  # blind TLS passthrough (no MITM) — npm etc.
        # else: destination is api.anthropic.com (or unknown) -> intercept + filter.

    # request fires for:
    #   - intercepted api.anthropic.com flows (decrypted) -> apply the Case-7 policy
    #   - any plain-HTTP forward request -> re-check the host allowlist (belt & braces)
    # It does NOT fire for passthrough (npm) connections — those are never decrypted.
    def request(self, flow: http.HTTPFlow) -> None:
        host = flow.request.pretty_host
        if not _host_allowed(host):
            _refuse(flow, "host not allowed")
            return

        if host != INTERCEPT_HOST:
            return  # allowed non-intercepted host (e.g. plain-HTTP to npm) — no body policy

        path = (flow.request.path or "/").split("?", 1)[0]

        if path in BLOCKED_PATH_EXACT:
            _refuse(flow, "endpoint blocked (identity/profile)")
            return
        if any(path.startswith(p) for p in BLOCKED_PATH_PREFIX):
            _refuse(flow, "endpoint blocked (files/upload sink)")
            return

        beta = flow.request.headers.get("anthropic-beta", "")
        if _WEB_TOOL_BETA.search(beta):
            _refuse(flow, "web_fetch/web_search beta header not permitted")
            return

        # Body inspection — only for content types that could carry a tool block.
        body = flow.request.get_text(strict=False) or ""
        if _WEB_TOOL_BODY.search(body):
            _refuse(flow, "web_fetch/web_search server-tool block not permitted")
            return
        # else: normal inference / models / token-count — pass through untouched.


addons = [C6Egress()]
