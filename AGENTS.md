# Agent Instructions

Paddock is a Go and React internal deployment platform: Coolify's job (deploy Compose apps to our own servers over SSH), moving toward Railway's project canvas. See README.md for the data model and deploy flow.

## Current Stack

- Backend: Go, chi, PostgreSQL, Redis, sqlc, `golang.org/x/crypto/ssh`, Server-Sent Events.
- Frontend: React, TypeScript, Vite, Tailwind CSS v4, shadcn-style components, TanStack Query, TanStack Router.
- Local infrastructure: Docker Compose with Postgres, Redis, and the Go app.
- Production: single Go binary serving the built React assets.

## Engineering Rules

- Keep changes small, readable, and easy to review.
- Prefer existing helpers and package structure before adding new abstractions.
- Do not reintroduce PHP, Laravel, Composer, Livewire, Horizon, Blade, or Pest.
- Do not turn this into a secrets manager. Integrate with secret systems through connectors.
- Secret values come from Doppler only. Runtime secret values are sourced exclusively from Doppler (the deploy runner depends on `internal/doppler` directly); the database stores references and metadata, never secret values. Connector `config` is for non-secret settings and is rejected server-side if it contains secret keys or material.
- Preserve the current dark UI palette and Prosights branding.
- Keep connector boundaries explicit. Provider-specific behavior belongs behind connector packages or HTTP handlers.
- Avoid complex nested logic. Split small functions when that improves clarity.
- Tests assert behavior, not source text. Do not add tests that grep SQL, Dockerfiles, or Go source.
- Released migrations are immutable (hash-checked); add a new numbered file instead.
- Use `GOTOOLCHAIN=go1.26.0` if the local Go is older than `go.mod`.

## Frontend Rules

One way to do each thing. Sources: react.dev "You Might Not Need an Effect" and Vercel's react-best-practices.

- **Server data lives in TanStack Query.** Every read is a `queryOptions` in `web/src/lib/queries.ts` that calls `api<T>(path)`. Components read it with `useSuspenseQuery(xQuery)` where the data is needed; route loaders preload it. Don't pass server data down more than one level; pass IDs and let the child read the query (use `select` to narrow).
- **Writes are functions in `web/src/lib/api.ts`,** called from `useMutation({ mutationFn })`. The `QueryClient` invalidates every query after any successful mutation, so components never call `invalidateQueries`. Validate inside `mutationFn` (throw an `Error`) and render `mutation.error`; no separate error state.
- **URL state belongs to the router.** Routes declare `validateSearch`; components use `Route.useSearch()` and `navigate({ search })`. Never read or write `window.location` / `window.history`.
- **Effects only synchronize with external systems** (EventSource, xterm, a global key listener). Derive values during render, run interaction logic in event handlers, reset state with `key`, and subscribe to browser APIs with `useSyncExternalStore`.
- **Browser-persisted UI state** (theme, canvas layout) uses `useLocalStorage` from `web/src/lib/use-local-storage.ts`.
- **Dialogs and drawers** use `web/src/components/ui/dialog.tsx`. Don't import `@radix-ui/react-dialog` in feature code.
- No `useMemo` / `useCallback` unless a measured problem needs it. No `forwardRef` (React 19 passes `ref` as a prop). No components defined inside components, and no pass-through wrapper components.
- Tests render the real router at a URL with `renderApp` from `web/src/test/render.tsx` and stub HTTP responses. Don't `vi.mock` our own modules.

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
docker build --progress=plain -t paddock:verify .
```

Clean verification artifacts after a Docker build:

```bash
docker image rm paddock:verify >/dev/null || true
rm -f server
rm -rf dist web/dist
```
