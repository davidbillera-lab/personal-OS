# Sandbox image for the autonomous dispatcher's build executor (C6-P2).
#
# Contract: node + git + claude-code and NOTHING else. No curl, no cloud CLIs,
# no host home. The container — not Claude's own deny-list — is the boundary.
# Auth is supplied at run time by a read-only bind mount of the host's
# ~/.claude/.credentials.json; the image itself holds zero secrets.
#
# Build:  npm run executor:image     (docker build -t mc-executor:latest docker/executor)
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

# --- Trust the executor proxy's TLS-terminating CA (C6, Case 7 fix) ----------
# The egress proxy MITMs api.anthropic.com to strip web_fetch/web_search relays and
# block /v1/files + /api/oauth/profile. For that, node/claude must trust the leaf certs
# the proxy mints, i.e. trust the proxy's CA. We install ONLY the PUBLIC CA cert
# (no private key ever enters this image). npm traffic is a blind passthrough (real
# registry cert), so it is unaffected. Two trust surfaces, both needed:
#   - system store (update-ca-certificates): git, curl-less base, any libssl consumer
#   - NODE_EXTRA_CA_CERTS: node & the claude CLI read this explicitly
COPY executor-proxy-ca.crt /usr/local/share/ca-certificates/mc-executor-proxy-ca.crt
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/mc-executor-proxy-ca.crt

# Non-root build user with a real home for ~/.claude.
RUN useradd -m -u 1001 builder
USER builder
ENV HOME=/home/builder
ENV LANG=C.UTF-8
WORKDIR /workspace

# Pre-accept onboarding + workspace trust so headless never blocks on a dialog.
# This replaces the host-side stampTrust() the non-container adapter needs.
RUN mkdir -p /home/builder/.claude \
 && printf '%s' '{"hasCompletedOnboarding":true,"projects":{"/workspace":{"hasTrustDialogAccepted":true}}}' \
    > /home/builder/.claude.json

# The bind-mounted /workspace/.git is owned by a different uid than `builder`,
# which trips git's dubious-ownership guard. The mount is the only repo present.
RUN git config --global --add safe.directory '*'

# node:* images ship ENTRYPOINT ["docker-entrypoint.sh"]; clear it so the run
# command is exactly the argv the adapter passes.
ENTRYPOINT []
