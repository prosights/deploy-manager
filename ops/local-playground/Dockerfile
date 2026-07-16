FROM alpine:3.23

RUN apk add --no-cache bash curl docker-cli docker-cli-compose git openssh-server && \
    mkdir -p /run/sshd /root/.ssh /srv/deploy-manager/apps && \
    ssh-keygen -A

CMD ["sh", "-lc", "install -m 600 /playground-key/id_ed25519.pub /root/.ssh/authorized_keys && exec /usr/sbin/sshd -D -e -o PermitRootLogin=prohibit-password -o PasswordAuthentication=no"]
