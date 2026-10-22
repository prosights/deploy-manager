# Paddock

Paddock is an internal platform for deploying Docker Compose apps to your own servers.

## What It Does

You register **servers** (any Linux VM you can SSH into), group your work into
**projects**, and add **services** (Docker Compose apps) to a project. Deploy
Manager builds each service, ships it to its server over SSH, puts a Caddy or
Traefik route in front of it, and streams the logs back to the browser.

It plays the same role as Coolify, and is moving toward Railway's project canvas.

## The Model

```text
projects 1 -> many environments 1 -> many applications (services) 1 -> many deployments 1 -> many deployment_logs
servers  1 -> many applications
applications 1 -> many proxy_routes
```

| Table | Plain meaning | Coolify / Railway equivalent |
| --- | --- | --- |
| `projects` | A group of services that ship together, with shared variables and registry. | Project |
| `environments` | `production`, `staging`, ... inside a project. | Environment |
| `servers` | An SSH-reachable VM that runs containers. | Server |
| `applications` | One deployable Compose stack (the UI calls it a "service"). | Resource / Service |
| `application_deployment_slots` | Which blue/green color is live, so we can roll back. | (added: needed for instant rollback) |
| `deployments` | One attempt to ship an application at a commit or image. | Deployment |
| `deployment_logs` | Log lines for a deployment. | Deployment logs |
| `build_runs` | A GitHub Actions image build that will trigger a deployment when it finishes. | Build |
| `proxy_routes` | A domain pointing at a service's upstream. | Domain |
| `project_runtime_variables` | Non-secret, project-wide env vars. | Shared variables |
| `application_service_runtime_configs` | Per-Compose-service Doppler scope and port. | Service variables |
| `container_registries` | Where built images are pushed. | Registry |
| `connector_accounts` | Settings for GitHub, Doppler, Slack, and Resend (never secrets). | Integrations |
| `audit_events` | Who did what. | Activity |
| `server_dev_sudo_users` | Linux users to provision on dev VMs. | (not in either) |

Secret values never touch the database. They come from Doppler at deploy time.

## How A Deploy Flows

1. A push hits `/api/webhooks/github`, or someone clicks Deploy, or a GitHub
   Actions build calls `/api/builds/{id}/complete` with an image.
2. The API writes a `deployments` row and pushes its id onto the Redis queue.
3. The worker (`internal/deployments`) picks it up, fetches runtime variables
   from Doppler, connects to the server over SSH (known_hosts enforced), and
   runs `docker compose` in the inactive blue/green slot.
4. If the health check passes, `internal/proxy` flips the Caddy/Traefik route
   to the new slot and the slot is recorded for rollback.
5. Every log line is saved to Postgres and fanned out over Redis to the browser
   through Server-Sent Events. Slack or Resend gets the final status.

## Code Map

| Path | What lives there |
| --- | --- |
| `cmd/server` | Wires config, Postgres, Redis, the worker, and the HTTP server. |
| `internal/httpapi` | Every `/api/*` handler, plus serving the built SPA. |
| `internal/deployments` | Queue, runner, remote step planner, log bus. |
| `internal/sshutil` | SSH client, key loading, host validation, server health metrics. |
| `internal/proxy` | Caddy/Traefik route commands, run over SSH. |
| `internal/githubconnector` | GitHub App client (repos, branches, workflow dispatch) and push webhook parsing. |
| `internal/compose` | Reads services, ports, and dependencies from a compose file. |
| `internal/doppler` | Reads runtime variables from Doppler (the only secret source). |
| `internal/runtimevars` | The env var type rendered into each deployment's `.env`. |
| `internal/notifications` | Slack and Resend deployment notifications. |
| `internal/db` | sqlc-generated queries (source: `db/queries/core.sql`). |
| `internal/migrations` | Embedded SQL migrations, run on startup. |
| `web/src/routes` | One file per page: projects, project canvas, servers, deployments, connectors, notifications, audit. |
| `web/src/features` | Larger UI pieces shared between pages (service drawer, logs, servers). |

Stack: Go (chi, pgx, sqlc, `x/crypto/ssh`), PostgreSQL, Redis, React +
TypeScript (Vite, Tailwind v4, TanStack Query/Router, Zustand). Production is
one Go binary that serves the built frontend.

## GitHub and Builds

GitHub integration is intentionally split into three layers:

1. **Repository access**: GitHub connector config stores repository metadata such as `owner/repo`, branch, and optional GitHub App installation ID. It must not store app private keys, OAuth secrets, webhook secrets, deploy keys, or tokens.
2. **Push sync**: GitHub sends signed `push` events to `/api/webhooks/github`. Paddock verifies `X-Hub-Signature-256` and matches the pushed repository and branch to applications with `github_auto_deploy=true`.
3. **Image builds**: build execution stays behind a provider boundary. When a matching GitHub connector owns the repository, Paddock dispatches a GitHub Actions workflow through the GitHub App installation token. The workflow owns Docker build/push and reports an `image_ref` back for deployment. Apps without a matching connector can still fall back to source-build-on-target from their repository and Compose path.

GitHub App repository sync requires server-side GitHub App credentials only. Set the app id and private key through the runtime environment or a private key file path. The database stores the installation id and repository metadata, not GitHub tokens or private keys. Repository build dispatch defaults to the workflow file `deploy-manager-build.yml` on the connected branch.

Each connected repository can also carry build metadata:

```json
{
  "repository": "prosights/recreate",
  "branch": "main",
  "workflow_id": "deploy-manager-build.yml",
  "build_context": ".",
  "dockerfile": "Dockerfile",
  "image_ref": "us-docker.pkg.dev/prosights/recreate/recreate:main",
  "runner": "ubuntu-latest"
}
```

When a build is dispatched, Paddock creates a `build_runs` row, passes `deploy_manager_build_id` plus the repository build metadata into GitHub Actions, and waits for the workflow to call `POST /api/builds/{buildID}/complete` with the pushed image reference. A successful callback matches applications by `repository_url` and branch, then queues blue/green deployments with that `image_ref`. The callback is protected by the normal API auth header in production; keep `DEPLOY_MANAGER_API_TOKEN` as a GitHub Actions secret, not in Paddock connector config.

To connect two repositories, add both repositories to a GitHub connector with their installation id, branch, workflow file, image ref, build context, Dockerfile, and runner. Then create or update the applications for those repos with the same branch and `github_auto_deploy=true`.

For Google Artifact Registry, copy `docs/workflows/deploy-manager-build-gar.yml` into each application repo as `.github/workflows/deploy-manager-build.yml`. Configure the repo with:

- GitHub variables: `DEPLOY_MANAGER_API_URL`, `GAR_REGISTRY_HOST`
- GitHub secrets: `DEPLOY_MANAGER_API_TOKEN`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`

The workflow uses GitHub OIDC to obtain a short-lived Google token and push to Artifact Registry. Do not add service-account JSON, registry passwords, or GitHub tokens to Paddock.

For GHCR, copy `examples/deploy-manager-build.yml` instead. Configure GitHub variables `REGISTRY_HOST=ghcr.io` and `DEPLOY_MANAGER_API_URL`, configure GitHub secret `DEPLOY_MANAGER_API_TOKEN`, and set the connector `image_ref` to the exact GHCR image tag Paddock should deploy.

## Self-Deploying Paddock

Paddock deploys itself through the same GitHub build and blue/green
deployment loop as application services. The production lane is:

```text
push to main -> GitHub App webhook -> workflow_dispatch -> Docker image
-> /api/builds/{id}/complete -> blue/green deploy on internal
-> Caddy upstream flip -> rollback slot recorded
```

Use `.github/workflows/deploy-manager-build.yml` for this repository. For
`main` builds, configure the GitHub connector image ref as an immutable template
such as:

```text
REGISTRY_HOST/NAMESPACE/REPOSITORY/deploy-manager:main-${SHORT_SHA}
```

The workflow also pushes `main`, `main-<short-sha>`, and `sha-<short-sha>`.
Pushing a Git tag like `v1.2.3` publishes that version tag when the GitHub repo
variable `DEPLOY_MANAGER_IMAGE` is set to the image name without a tag. Version
tag pushes are for release bookkeeping and rollback reference; automatic
production deployment stays on `main`.

On the `internal` VM, keep PostgreSQL and Redis outside the color swap and run
only the app container through Paddock. The bootstrap files and exact
application/proxy settings live in `ops/self-deploy/`.

See `docs/build-provider-decision.md` for the current build-provider recommendation.

Keep the build-provider choice out of projects. Projects should reference applications, repositories, environments, registries, and VM targets; a separate build connector/provider should create an image, push it to the configured registry, then queue a deployment with `image_ref`.

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
npm run typecheck
npm run build
docker compose config --quiet
docker compose -f docker-compose.dev.yml config --quiet
git diff --check
docker build --progress=plain -t paddock:verify .
```
