# Doppler-only runtime environment

Every application Deploy Manager deploys gets its runtime environment through
Doppler at start time. This is a mandate, not a default: **no env file ever
exists on a deployment target, and there is no alternative env path.** This
document explains how that works and which leak vectors the design closes.

## How a deployment gets its env

```text
1. Deploy Manager (control plane) resolves the application's Doppler
   project/config mapping. Deployments fail if the mapping is missing.
2. The control plane mints a short-lived, read-only Doppler service token
   scoped to exactly that config:
       doppler configs tokens create <deploy-name> \
         --project <project> --config <config> --max-age 30m --plain
   Doppler revokes the token automatically when it expires.
3. Every docker compose command on the target runs wrapped in doppler run:
       cd /srv/app \
         && IFS= read -r DOPPLER_TOKEN ... && export DOPPLER_TOKEN \
         && doppler run --project <project> --config <config> --no-fallback -- \
            env COMPOSE_PROJECT_NAME=<slug> DEPLOY_IMAGE=<ref> \
            docker compose -f docker-compose.yml up -d --remove-orphans
   The token arrives over SSH stdin; the doppler CLI on the target fetches
   secrets straight from Doppler over HTTPS into the process environment.
4. Compose interpolates ${VARS} from that process environment. Services
   receive only the variables their compose file declares.
```

Secret values never pass through Deploy Manager: the control plane cannot
download secret values at all (the connector interface has no method for it),
it only mints tokens. The target holds secrets in process memory for the
lifetime of the compose command.

## Leak vectors and how each is closed

| Vector | Status |
| --- | --- |
| Env file on the target's disk | Never written. The deploy plan has no env-file step, and a guard step removes legacy `.env` files from earlier deployment models. |
| `env_file:` in an application compose file | Rejected. The guard step fails the deployment if the compose file references `env_file`. |
| Token or secrets in `ps`/argv | The service token travels over SSH stdin into `IFS= read -r DOPPLER_TOKEN`; it never appears in a command line. Secret values never appear in any command. |
| Shell history | Nothing secret is ever part of a typed or executed command string. |
| Doppler CLI fallback cache | `doppler run --no-fallback` disables the CLI's encrypted on-disk secret snapshot. |
| Long-lived credentials on the VM | None. Each deployment gets a fresh token with `--max-age 30m`, read-only, scoped to one config. A leaked token cannot write, cannot see other configs, and dies on its own. |
| Deployment logs / audit metadata | Log output passes through sensitive-text redaction; the token is never logged. |
| Control-plane database | Stores the project/config mapping only — references, never values. |

Residual, accepted exposure: while a container runs, its environment is
visible to root on the host via `docker inspect` and `/proc/<pid>/environ`
(same-user/root only). That is inherent to environment-based configuration
and is scoped to the single config the application already owns.

## What this requires of applications

- Every application must be mapped to a Doppler project + config. Deployments
  fail fast with a clear error if the mapping is missing.
- Compose files must consume variables via `${VAR}` interpolation or
  `environment:` passthrough names — never `env_file:`.
- The `doppler` CLI must be installed on deployment targets (the guard step
  verifies this and fails with instructions if missing). The Deploy Manager
  self-deploy host runner image already includes it.

## What this requires of the control plane

`DOPPLER_TOKEN` on the control plane must be allowed to create service tokens
for the projects it deploys (a Service Account token or personal token with
config access; a plain read-only service token cannot mint tokens). The
control plane image ships the doppler CLI.

## Non-secret artifact variables

`DEPLOY_IMAGE`, `DEPLOY_IMAGE_TAG`, `<APP>_IMAGE_TAG`, `DEPLOY_COLOR`, and
`DEPLOY_PORT` are control-plane-owned deployment facts, not secrets. They are
applied inline via `env` *after* Doppler injection so a Doppler variable can
never override the pinned image for a deployment.
