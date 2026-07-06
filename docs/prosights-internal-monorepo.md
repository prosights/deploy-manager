# Prosights Internal Monorepo Deployment

`prosights/internal` is one repository with multiple deployable apps:

| Deploy Manager project | Deploy Manager app | Repo path | Compose path | Images |
| --- | --- | --- | --- | --- |
| `internal` | `portal` | `portal/` | `portal/compose.coolify.yml` | `portal` |
| `internal` | `finops` | `finops/` | `finops/compose.coolify.yml` | `finops-api`, `finops-web` |
| `internal` | `alleyes` | `alleyes/` | `alleyes/compose.coolify.yml` | `alleyes-api`, `alleyes-web` |

Use one Deploy Manager project named `internal`, not three separate projects.
The project owns environments such as `production`; each deployable compose
stack is an application inside that project.

## Deploy Manager Model

The GitHub connector supports multiple build targets for the same
`repository + branch`.

Each build target needs:

- application id or application name
- repository: `prosights/internal`
- branch: `main`
- path filters, for example `finops/**`
- workflow id, for example `deploy-manager-build.yml`
- single-image metadata or `build_matrix` JSON for every image the app needs
- immutable output image tag, usually `sha-<commit>` or a commit-derived tag
- runner label, initially `linux_32_core`

Example connector targets:

```json
{
  "installation_id": "12345678",
  "repositories": [
    {
      "repository": "prosights/internal",
      "branch": "main",
      "application_name": "portal",
      "path_filters": ["portal/**"],
      "workflow_id": "deploy-manager-monorepo-gar.yml",
      "image_ref": "us-east4-docker.pkg.dev/prosights-platform/internal/portal:sha-${COMMIT_SHA}",
      "build_matrix": "[{\"image_ref\":\"us-east4-docker.pkg.dev/prosights-platform/internal/portal:sha-${COMMIT_SHA}\",\"build_context\":\"portal\",\"dockerfile\":\"portal/Dockerfile\"}]",
      "runner": "linux_32_core"
    },
    {
      "repository": "prosights/internal",
      "branch": "main",
      "application_name": "finops",
      "path_filters": ["finops/**"],
      "workflow_id": "deploy-manager-monorepo-gar.yml",
      "image_ref": "us-east4-docker.pkg.dev/prosights-platform/internal/finops-api:sha-${COMMIT_SHA}",
      "build_matrix": "[{\"image_ref\":\"us-east4-docker.pkg.dev/prosights-platform/internal/finops-api:sha-${COMMIT_SHA}\",\"build_context\":\"finops\",\"dockerfile\":\"finops/api/Dockerfile\"},{\"image_ref\":\"us-east4-docker.pkg.dev/prosights-platform/internal/finops-web:sha-${COMMIT_SHA}\",\"build_context\":\"finops\",\"dockerfile\":\"finops/web/Dockerfile\"}]",
      "runner": "linux_32_core"
    },
    {
      "repository": "prosights/internal",
      "branch": "main",
      "application_name": "alleyes",
      "path_filters": ["alleyes/**"],
      "workflow_id": "deploy-manager-monorepo-gar.yml",
      "image_ref": "us-east4-docker.pkg.dev/prosights-platform/internal/alleyes-api:sha-${COMMIT_SHA}",
      "build_matrix": "[{\"image_ref\":\"us-east4-docker.pkg.dev/prosights-platform/internal/alleyes-api:sha-${COMMIT_SHA}\",\"build_context\":\"alleyes\",\"dockerfile\":\"alleyes/api/Dockerfile\"},{\"image_ref\":\"us-east4-docker.pkg.dev/prosights-platform/internal/alleyes-web:sha-${COMMIT_SHA}\",\"build_context\":\"alleyes\",\"dockerfile\":\"alleyes/web/Dockerfile\"}]",
      "runner": "linux_32_core"
    }
  ]
}
```

## Push Flow

1. GitHub push arrives for `prosights/internal`.
2. Deploy Manager verifies the webhook signature.
3. Deploy Manager inspects changed paths.
4. It dispatches builds only for affected apps:
   - `portal/**` -> `portal`
   - `finops/**` -> `finops`
   - `alleyes/**` -> `alleyes`
5. GitHub Actions builds all images required by that app and pushes immutable tags.
6. GitHub Actions calls `POST /api/builds/{buildID}/complete`.
7. Deploy Manager deploys only the application tied to that build id.

## Deployment Flow

Each application remains a compose stack on the target VM:

- `portal`: static web container
- `finops`: API, web, workers, Postgres, Cloud SQL proxy
- `alleyes`: API, monitoring worker, web, Cloud SQL proxy

For blue/green deployment, compose files must avoid fixed host ports and use
Deploy Manager-provided variables such as `DEPLOY_PORT` or app-specific port
variables. Any app with multiple externally routed services needs proxy routes
for each domain.

## Compose Contract

Deploy Manager writes these artifact variables into the remote `.env` file:

- `DEPLOY_IMAGE`
- `DEPLOY_IMAGE_TAG`
- `<APPLICATION_NAME>_IMAGE_TAG`, for example `FINOPS_IMAGE_TAG`

For `finops` and `alleyes`, compose files should read the app-specific tag
variable for every image in the stack. For example:

```yaml
x-api-image: &api-image us-east4-docker.pkg.dev/prosights-platform/internal/finops-api:${FINOPS_IMAGE_TAG:-latest}
x-web-image: &web-image us-east4-docker.pkg.dev/prosights-platform/internal/finops-web:${FINOPS_IMAGE_TAG:-latest}
```

Do not solve this by creating three Deploy Manager projects. Use one project
and separate applications inside it.
