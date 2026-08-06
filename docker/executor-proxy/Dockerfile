# TLS-terminating allowlisting egress proxy — the executor sandbox's ONLY route to
# the internet (C6-P3, hardened for Case 7). It sits on two networks:
# mc-executor-net (--internal, no route out) and mc-executor-egress (normal bridge).
#
# UNLIKE the old tinyproxy blind tunnel, this proxy TERMINATES TLS for
# api.anthropic.com so it can inspect and filter requests (strip web_fetch/web_search
# server-tool relays, block /v1/files + /api/oauth/profile). Every OTHER allowed host
# (npm) is a blind TLS passthrough — we do NOT MITM it. Policy: docker/executor-proxy/addon.py.
#
# It signs MITM leaf certs with a STABLE baked CA (ca/mitmproxy-ca.pem = key+cert). The
# executor image trusts the matching PUBLIC cert (ca/mitmproxy-ca-cert.pem). The proxy
# now DOES hold a secret (the CA key + the plaintext token in transit) — the accepted
# cost of inspection. Generate the CA first: node docker/executor-proxy/gen-ca.mjs
#
# Build: npm run executor:net   (regenerates CA if missing, then builds + restarts proxy)
FROM mitmproxy/mitmproxy:11.1.3

# Filtering addon + host allowlist (allowlist.txt is documentation/parity; the
# authoritative allowlist lives in addon.py ALLOWED_HOSTS).
COPY addon.py       /addon.py
COPY allowlist.txt  /etc/executor-proxy/allowlist.txt

# The STABLE signing CA (private key + cert). mitmproxy reads mitmproxy-ca.pem from its
# confdir instead of generating an ephemeral one. GITIGNORED — never in the repo, only
# ever in this local image. Placed for the unprivileged `mitmproxy` user (uid 1000).
COPY ca/mitmproxy-ca.pem /home/mitmproxy/.mitmproxy/mitmproxy-ca.pem

USER root
RUN chown -R mitmproxy:mitmproxy /home/mitmproxy/.mitmproxy \
 && chmod 600 /home/mitmproxy/.mitmproxy/mitmproxy-ca.pem
USER mitmproxy

EXPOSE 8888

# regular forward-proxy mode on 8888. ssl_insecure: mitmproxy must connect UPSTREAM to
# the real api.anthropic.com — it still verifies the real cert (default), this stays off.
# confdir pins our baked CA. The addon is deny-by-default.
ENTRYPOINT ["mitmdump"]
# NOTE: request bodies are deliberately NOT streamed — the addon must see the full
# JSON body to detect web_fetch/web_search tool blocks. Do not add stream_large_bodies.
CMD ["--mode", "regular", "--listen-host", "0.0.0.0", "--listen-port", "8888", \
     "--set", "confdir=/home/mitmproxy/.mitmproxy", \
     "--set", "block_global=false", \
     "-s", "/addon.py", \
     "--flow-detail", "0"]
