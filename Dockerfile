FROM node:24-alpine AS web
WORKDIR /src
COPY package*.json tsconfig.json vite.config.ts ./
COPY web ./web
RUN npm ci
RUN npm run build

FROM golang:1.26-alpine AS server
WORKDIR /src
RUN apk add --no-cache git
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN go build -o /out/deploy-manager ./cmd/server

FROM alpine:3.23
WORKDIR /app
RUN apk add --no-cache ca-certificates docker-cli docker-cli-compose openssh-client tailscale && \
    wget -q -t3 'https://packages.doppler.com/public/cli/rsa.8004D9FF50437357.key' -O /etc/apk/keys/cli@doppler-8004D9FF50437357.rsa.pub && \
    echo 'https://packages.doppler.com/public/cli/alpine/any-version/main' >> /etc/apk/repositories && \
    apk add --no-cache doppler && \
    adduser -D deploy && \
    touch /app/known_hosts && \
    chown deploy:deploy /app/known_hosts && \
    chmod 600 /app/known_hosts
COPY --from=server /out/deploy-manager /usr/local/bin/deploy-manager
COPY --from=web /src/web/dist ./web/dist
ENV HTTP_ADDR=:8080
ENV STATIC_DIR=/app/web/dist
ENV SSH_KNOWN_HOSTS_PATH=/app/known_hosts
ENV DOPPLER_CLI_PATH=doppler
ENV DOPPLER_CONFIG_DIR=/tmp/.doppler
USER deploy
EXPOSE 8080
CMD ["deploy-manager"]
