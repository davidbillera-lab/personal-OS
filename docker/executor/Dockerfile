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
