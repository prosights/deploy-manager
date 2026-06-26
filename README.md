# Deploy Manager

Deploy Manager is a slim internal control plane for remote server management and Docker Compose deployments.

It registers SSH-accessible servers, validates connectivity, monitors resource health, deploys application stacks, manages Caddy or Traefik proxy routes, streams deployment logs, and keeps an inventory of credentials with permission and usage visibility. It does not manage secret values directly; systems such as Doppler are integrated through connectors.

## Stack

- Go backend with chi, sqlc, PostgreSQL, Redis, SSH, Docker SDK, and SSE log streaming.
- React + TypeScript frontend built with Vite, Tailwind CSS v4, TanStack Query, TanStack Router, and Zustand.
- Docker Compose for local development.
- Single production image with the Go server serving built frontend assets.

## Local Development

```bash
docker compose -f docker-compose.dev.yml up --build
```

The app listens on `http://localhost:8080` by default.

For local frontend/backend iteration outside Compose:

```bash
npm install
npm run dev
go run ./cmd/server
```

Set `DATABASE_URL` and `REDIS_URL` when running the Go server directly.

## Verification

```bash
if command -v sqlc >/dev/null 2>&1; then sqlc generate; else $(go env GOPATH)/bin/sqlc generate; fi
GOFLAGS=-mod=mod go test ./...
GOFLAGS=-mod=mod go build ./cmd/server
npm test
npm run lint
npm run build
docker compose config --quiet
docker compose -f docker-compose.dev.yml config --quiet
git diff --check
docker build --progress=plain -t deploy-manager:verify .
```
