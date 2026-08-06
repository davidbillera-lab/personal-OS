# Allowlisting forward proxy — the executor sandbox's ONLY route to the internet
# (C6-P3). It sits on two networks: mc-executor-net (--internal, no route out)
# and mc-executor-egress (normal bridge). Holds no secrets and terminates no TLS
# (CONNECT is a blind tunnel), so it is not a credential-bearing component.
#
# Build: npm run executor:net   (or: docker build -t mc-executor-proxy:latest docker/executor-proxy)
FROM alpine:3.20

RUN apk add --no-cache tinyproxy

COPY tinyproxy.conf /etc/tinyproxy/tinyproxy.conf
COPY allowlist.txt  /etc/tinyproxy/allowlist.txt

# Unprivileged: nothing here needs root, and there is no privileged port.
USER tinyproxy

EXPOSE 8888
ENTRYPOINT ["tinyproxy", "-d", "-c", "/etc/tinyproxy/tinyproxy.conf"]
