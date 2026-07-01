# Agent Instructions

Deploy Manager is a Go and React internal deployment control plane. The Laravel/Coolify runtime has been removed.

## Current Stack

- Backend: Go, chi, PostgreSQL, Redis, sqlc, Docker SDK for Go, `golang.org/x/crypto/ssh`, Server-Sent Events.
- Frontend: React, TypeScript, Vite, Tailwind CSS v4, shadcn-style components, TanStack Query, TanStack Router, Zustand.
- Local infrastructure: Docker Compose with Postgres, Redis, and the Go app.
- Production: single Go binary serving the built React assets.

## Engineering Rules

- Keep changes small, readable, and easy to review.
- Prefer existing helpers and package structure before adding new abstractions.
- Do not reintroduce PHP, Laravel, Composer, Livewire, Horizon, Blade, or Pest.
- Do not turn this into a secrets manager. Integrate with secret systems through connectors.
- Secret values come from Doppler only. Runtime secret values are sourced exclusively from the Doppler connector (enforced at startup by `requireDopplerRuntimeSource`); the database stores references and metadata, never secret values. Connector `config` is for non-secret settings and is rejected server-side if it contains secret keys or material. The `npm run lint` script runs ESLint; `npm run typecheck` runs `tsc`.
- Preserve the current dark UI palette and white-label branding behavior.
- Keep connector boundaries explicit. Provider-specific behavior belongs behind connector packages or HTTP handlers.
- Avoid complex nested logic. Split small functions when that improves clarity.

## Verification

Run the narrowest useful checks while iterating. Before calling a runtime cleanup or broad refactor done, run:

```bash
if command -v sqlc >/dev/null 2>&1; then sqlc generate; else $(go env GOPATH)/bin/sqlc generate; fi
GOFLAGS=-mod=mod go test ./...
GOFLAGS=-mod=mod go build ./cmd/server
npm test
npm run lint
npm run typecheck
npm run build
docker compose config --quiet
docker compose -f docker-compose.dev.yml config --quiet
git diff --check
docker build --progress=plain -t deploy-manager:verify .
```

Clean verification artifacts after a Docker build:

```bash
docker image rm deploy-manager:verify >/dev/null || true
rm -f server
rm -rf dist web/dist
```
