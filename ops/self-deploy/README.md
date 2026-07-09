# Deploy Manager self-deploy

This directory is the bootstrap contract for running Deploy Manager on the
`internal` VM and then letting Deploy Manager deploy itself with blue/green.

The stateful services are intentionally separate from the color-swapped app
container:

- `stateful-compose.yml` runs PostgreSQL and Redis on the stable
  `control_default` Docker network.
- `docker-compose.yml` runs only the Deploy Manager app image. Deploy Manager
  starts it twice, once for blue and once for green, on local ports 3101/3102.
- Caddy routes `deploy.internal.prosights.co` to the currently promoted color.

## One-time VM bootstrap

Runtime env is Doppler-only: no `.env` file may exist anywhere on the VM.
Bootstrap commands run under `doppler run` with a token that lives only in
your shell session (read it with `read -rs` so it never lands in history or a
file):

```bash
sudo mkdir -p /srv/deploy-manager/control /srv/deploy-manager/control/secrets /srv/deploy-manager/apps/production/deploy-manager
cd /srv/deploy-manager/control
read -rs DOPPLER_TOKEN && export DOPPLER_TOKEN   # paste a read-only service token, then Enter
doppler run --project deploy-manager --config prd --no-fallback -- \
  docker compose -f stateful-compose.yml up -d
unset DOPPLER_TOKEN
```

Put private files such as the GitHub App private key under
`/srv/deploy-manager/control/secrets`. Do not create
`/srv/deploy-manager/control/.env` — the app compose no longer reads it, and
deployments delete stray `.env` files and reject compose files that use
`env_file:`. See `docs/doppler-runtime-env.md` in the repository root.

## Deploy Manager application settings

Create one application for the control plane itself:

| Field | Value |
| --- | --- |
| Name | `deploy-manager` |
| Repository | `https://github.com/prosights/deploy-manager.git` |
| Branch | `main` |
| Server | `internal` |
| Compose path | `docker-compose.yml` |
| Remote directory | `/srv/deploy-manager/apps/production/deploy-manager` |
| Health check URL | `http://127.0.0.1:{port}/api/readyz?color={color}` |
| Auto deploy | enabled |

The health URL includes `{color}` because blue/green deployments require it,
and uses `{port}` so each new color is checked before traffic moves.

Create a proxy route for the same application:

| Field | Value |
| --- | --- |
| Domain | `deploy.internal.prosights.co` |
| Blue upstream | `http://127.0.0.1:3101` |
| Green upstream | `http://127.0.0.1:3102` |
| TLS | enabled |

## GitHub build target

The GitHub connector entry for this repo should point at `main` and this
workflow:

```json
{
  "repository": "prosights/deploy-manager",
  "branch": "main",
  "workflow_id": "deploy-manager-build.yml",
  "build_context": ".",
  "dockerfile": "Dockerfile",
  "image_ref": "REGISTRY_HOST/NAMESPACE/REPOSITORY/deploy-manager:main-${SHORT_SHA}",
  "runner": "ubuntu-latest"
}
```

Use the real Artifact Registry path in `image_ref`. The workflow pushes these
tags for every dispatched `main` build:

- `main-<short-sha>`: immutable tag Deploy Manager deploys.
- `sha-<short-sha>`: immutable tag for audit/debugging.
- `main`: moving convenience tag for humans.

Pushing a Git tag such as `v1.2.3` also publishes `v1.2.3` when the GitHub repo
variable `DEPLOY_MANAGER_IMAGE` is set to the image name without a tag, for
example `us-east1-docker.pkg.dev/prosights-platform/deploy-manager/deploy-manager`.
Tag pushes do not auto-deploy; production auto-deploys from `main`.

## Runtime env

All runtime variables live in the Doppler project/config mapped to the
`deploy-manager` application (for example `deploy-manager/prd`). Deploy
Manager wraps every compose command for this app in `doppler run`, so the
variables are injected into process memory and passed through by name in
`docker-compose.yml` — nothing is written to the VM. Define at least:

```text
POSTGRES_PASSWORD
API_TOKEN
GITHUB_WEBHOOK_SECRET
GITHUB_APP_ID
GITHUB_APP_SLUG
GITHUB_APP_PRIVATE_KEY_PATH=/app/secrets/prosights-deploy-manager.private-key.pem
DOPPLER_PROJECT
DOPPLER_CONFIG
DOPPLER_TOKEN
```

`DOPPLER_TOKEN` here is the control plane's own token: it must be able to
create service tokens for the projects Deploy Manager deploys (Service
Account token), not a plain read-only service token.

`DATABASE_URL` and `REDIS_URL` can be omitted when using
`stateful-compose.yml`; the app compose derives them from the local Postgres and
Redis service names.

## Rollout behavior

1. A push to `main` hits the Deploy Manager GitHub webhook.
2. Deploy Manager dispatches `.github/workflows/deploy-manager-build.yml`.
3. GitHub Actions builds and pushes `main-<short-sha>`.
4. The workflow calls back to `/api/builds/{id}/complete`.
5. Deploy Manager starts the inactive color on port 3101 or 3102.
6. Deploy Manager checks `/api/readyz`.
7. Deploy Manager flips the Caddy upstream to the healthy color and records the
   previous color as rollback standby.

Rollback only flips Caddy back to the standby color; it does not rebuild.
