FROM alpine:3.23

RUN apk add --no-cache bash curl docker-cli docker-cli-compose git openssh-server python3 shadow sudo && \
    mkdir -p /run/sshd /root/.ssh /srv/deploy-manager/apps /opt/infrastructure && \
    ssh-keygen -A

COPY Caddyfile /usr/local/share/deploy-manager/Caddyfile

CMD ["sh", "-lc", "test -f /opt/infrastructure/Caddyfile || install -m 644 /usr/local/share/deploy-manager/Caddyfile /opt/infrastructure/Caddyfile; install -m 600 /playground-key/id_ed25519.pub /root/.ssh/authorized_keys; exec /usr/sbin/sshd -D -e -o PermitRootLogin=prohibit-password -o PasswordAuthentication=no"]
