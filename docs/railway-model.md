# Railway, reverse engineered, and how Paddock does it on our own clouds

Status: proposal (UX plan: [ux.md](ux.md)). Evidence collected 2026-10-20 from Railway's live public GraphQL schema
(`backboard.railway.com/graphql/v2`), the open-source CLI (`railwayapp/cli` @ `b62467e`), Railpack
(`railwayapp/railpack` @ `fc09405`), the docs source (`railwayapp/docs` @ `7235449`), and Railway's
blog and pricing page. **Observed** means read in one of those sources; **inferred** is our reading;
**unknown** is not published.

## 1. What makes Railway feel simple

| # | Mechanism | Evidence |
|---|---|---|
| 1 | One canvas per project, always scoped to one environment. | Observed (docs: projects, environments) |
| 2 | Everything is a **service**: a repo, an image, a cron job or a database. Databases are services created from templates; the old "plugins" are deprecated. | Observed (schema `Plugin.deprecatedAt`, CLI `add.rs:148`) |
| 3 | A service is only a name. Its settings live on the **service instance** (service × environment), so staging can track another branch with a different size. | Observed (schema `ServiceInstance`) |
| 4 | **An environment's whole configuration is one JSON document.** Every edit is a *patch* that is staged, then committed as a batch with a message. Copying an environment, PR environments, sync, scaling and rollback all reuse this. | Observed (schema `Environment.config`, `EnvironmentPatch`; CLI `environment/new.rs`) |
| 5 | Reference variables: `${{api.RAILWAY_PRIVATE_DOMAIN}}`, `${{shared.X}}`. They also decide deploy order. | Observed (docs: variables) |
| 6 | Injected variables (`RAILWAY_PUBLIC_DOMAIN`, `RAILWAY_PRIVATE_DOMAIN`, `RAILWAY_TCP_PROXY_PORT`, …) mean nothing is wired by hand. | Observed (docs: variables/reference) |
| 7 | One click → `*.up.railway.app` with TLS. Custom domain = CNAME plus a `railway-verify=` TXT record. | Observed (docs: domains; CLI `domain.rs`) |
| 8 | Private DNS `<service>.railway.internal`, isolated per environment. | Observed (docs: private networking) |
| 9 | Deploys gate on a health check, then swap traffic at the edge. Optional overlap and draining. | Observed (docs: healthchecks, teardown) |
| 10 | PR environments are created on open and deleted on merge or close. | Observed (docs: environments) |

Railway's simplicity comes from **one per-environment configuration document plus staged patches**,
not from many tables. That is the idea to copy.

## 2. Where Railway is weak and we can be better

| Railway | Paddock |
|---|---|
| A 2 vCPU / 4 GB service running 24×7 costs ≈ **$81/month**; there are no committed-use or spot prices. | The same capacity costs **$19–49/month** on AWS or GCP with Savings Plans, committed-use discounts or spot, and one VM hosts several stacks. |
| 4 regions, no instance-type or disk choice, volumes capped at 3k IOPS. | Any AWS or GCP region, any instance family and disk type, chosen per server. |
| No private connection into your own cloud; cross-environment traffic is billed public egress. | Every VM is on our tailnet. App VMs have **no public IP and no public SSH**, only Tailscale SSH. |
| Health checks stop once a deploy is live. | Keep probing after go-live and fall back to the standby blue/green slot automatically. |
| 19 May 2026: a GCP account suspension took down workloads on Railway Metal and AWS too, because the edge's route cache expired against a control plane hosted in GCP. | Each edge and server keeps its last applied proxy config **on disk**, so traffic keeps flowing when Paddock is down. |
| CPU, memory, disk and network metrics only. | Add request rate, p95 latency and 5xx rate from proxy access logs, plus **cost per service, project and environment**. |
| The hard spending limit takes every workload offline. | Budgets alert and suggest scale-downs (sleep previews, smaller instances), but never cut production. |
| `railway.toml` and Railway-only variables create lock-in. | Docker Compose stays the source of truth; leaving means `docker compose up`. |

## 3. Exposure without opening VMs

```
Internet → edge server (public 80/443 only, Caddy) ──Tailscale──→ app server (no public IP)
                                                                    └─ blue/green Compose slot on 127.0.0.1:<port>
Operators → Tailscale SSH → any server (no SSH keys, no port 22 on the internet)
```

- **Generated domains:** a wildcard `*.apps.<ourdomain>` points at the edge. A service gets `<service>-<environment>-<project>.apps.<ourdomain>`.
- **Custom domains:** the user adds a CNAME to the generated name plus a TXT record `dm-verify=<token>`. Caddy's on-demand TLS calls the Paddock `ask` endpoint, which issues a certificate only for verified domains.
- **TCP proxy (databases, gRPC):** a port allocated on the edge from a fixed range, unique in Postgres and stable for the life of the service. For admin access, prefer Tailscale.
- **Private networking:**
  - Services in the same Compose stack talk over the stack network.
  - Across servers, they use `<service>.<environment>.<project>.internal`. A CoreDNS on the tailnet serves those names from our DB, pointing at the server's tailnet IP and published port.
  - Tailscale ACL tags per environment keep production and previews apart.
- **One edge per cloud.** Use a cloud load balancer (AWS NLB or GCP external LB) in front of the edges only if one edge VM is not enough.

## 4. Data model

**Relationship summary**

```
cloud_accounts 1 → many servers
projects 1 → many environments
projects 1 → many services
services × environments → service_instances (one row per pair)
service_instances 1 → many deployments 1 → many deployment_logs
service_instances 1 → 2 deployment_slots (blue, green)
service_instances 1 → many domains
environments 1 → many changes (staged patches, as in Railway's EnvironmentPatch)
servers 1 → many usage_samples
```

**Familiar reference: Railway.** This maps 1:1 onto Railway's `project`, `environment`, `service`,
`serviceInstance`, `deployment`, `serviceDomain`/`customDomain`/`tcpProxy`, `variable` and
`environmentPatch`. We add three tables Railway does not expose:

- `cloud_accounts` and `servers`: Railway owns its hardware; we place work on our own AWS and GCP machines.
- `usage_samples`: Railway bills you for usage; we turn usage into cost and sizing advice.

What changes from today's schema:
- `applications` splits into `services` and `service_instances`.
- `project_runtime_variables` and `application_service_runtime_configs` merge into `variables`.
- `proxy_routes` becomes `domains`.
- `application_deployment_slots` becomes `deployment_slots`.

### cloud_accounts: one AWS account or GCP project we deploy into (≈2–5)

| Column | Links to | Meaning |
|---|---|---|
| id (key) | | |
| provider | | `aws` or `gcp` |
| name | | Label, e.g. "prod AWS" |
| external_id | | AWS account ID or GCP project ID |
| default_region | | Where new servers go unless told otherwise |
| credentials_ref | | Name of the Doppler secret (or workload-identity role) used to call the cloud API. Never the credential itself. |
| tailscale_tag | | ACL tag given to servers in this account, e.g. `tag:dm-aws-prod` |

### servers: a VM that runs stacks or serves as an edge (≈5–50)

| Column | Links to | Meaning |
|---|---|---|
| id (key) | | |
| cloud_account_id | → cloud_accounts.id | Empty for a manually registered machine |
| role | | `app` (runs services, no public IP) or `edge` (public 80/443, routes over the tailnet) |
| name | | Display name |
| region | | e.g. `us-east-1`, `us-central1` |
| instance_type | | e.g. `t3.large`, `e2-standard-4` |
| cloud_instance_id | | ID in AWS or GCP, used to stop, resize or terminate |
| pricing | | `on_demand`, `spot` or `committed` |
| hourly_price_usd | | From the AWS Pricing API or GCP Billing Catalog at provision time |
| vcpus | | Capacity used for placement and cost split |
| memory_mb | | Capacity used for placement and cost split |
| tailscale_host | | MagicDNS name; the only way Paddock and people reach the machine |
| proxy_type | | `caddy` or `traefik` (kept from today) |
| status | | `provisioning`, `healthy`, `degraded`, `unreachable`, `terminated` |

`hostname`, `ssh_port` and `ssh_key_path` go away: Tailscale SSH replaces them.

### projects: one canvas (≈10–50), unchanged

| Column | Links to | Meaning |
|---|---|---|
| id (key) | | |
| name | | Display name |
| slug | | Used in generated domains and private DNS |
| monthly_budget_usd | | Alert threshold for the project's cost; empty means no alert |

### environments: production, staging, PR previews (≈2–10 per project)

| Column | Links to | Meaning |
|---|---|---|
| id (key) | | |
| project_id | → projects.id | Owner |
| name | | e.g. "production" |
| source_environment_id | → environments.id | The environment it was copied from. Points at its own table on purpose: a preview is a copy of staging. |
| pull_request_number | | Set for PR previews |
| expires_at | | Previews are deleted after this (exists today) |
| sleep_when_idle | | Previews stop their containers after inactivity and wake on the next request |

### services: a name on the canvas (≈3–30 per project)

| Column | Links to | Meaning |
|---|---|---|
| id (key) | | |
| project_id | → projects.id | Owner |
| name | | Shown on the canvas; used in `${{name.VAR}}` and private DNS |
| icon | | Canvas icon |

As in Railway, a service has **no settings**. Everything that can differ by environment lives on `service_instances`.

### service_instances: a service's settings in one environment (services × environments)

| Column | Links to | Meaning |
|---|---|---|
| id (key) | | |
| service_id | → services.id | Which service |
| environment_id | → environments.id | Which environment |
| server_id | → servers.id | Where it runs. Chosen by placement (most free capacity in the region) unless pinned. |
| source_repository | | GitHub `owner/repo`, or empty for an image |
| source_branch | | Branch to track |
| source_image | | Image to run when there is no repository |
| compose_path | | Compose file inside the repository |
| watch_paths | | Only pushes that touch these paths deploy |
| health_check_path | | Must return 2xx before traffic moves |
| cpu_limit | | vCPUs reserved (Compose `deploy.resources.limits`); used for placement and cost |
| memory_limit_mb | | Memory reserved; used for placement and cost |
| replicas | | Copies to run |
| cron_schedule | | Set for cron services |
| doppler_project | | Where secrets come from (reference only) |
| doppler_config | | Where secrets come from (reference only) |

### variables: plain, non-secret values (≈10–100 per environment)

| Column | Links to | Meaning |
|---|---|---|
| id (key) | | |
| environment_id | → environments.id | Variables are always per environment |
| service_id | → services.id | Empty means shared by every service in the environment |
| key | | e.g. `API_URL` |
| value | | May contain `${{api.DM_PRIVATE_DOMAIN}}`, resolved when the deploy renders `.env`. Secrets stay in Doppler. |

### changes: staged edits to an environment (≈1 staged plus history)

| Column | Links to | Meaning |
|---|---|---|
| id (key) | | |
| environment_id | → environments.id | Which environment |
| patch | | Partial JSON of the environment's configuration (service instances, variables, domains) |
| status | | `staged`, `applying`, `applied` or `failed`; at most one `staged` per environment |
| message | | What changed, like a commit message |
| applied_by | | Who clicked deploy |
| applied_at | | When |

### deployments: one rollout of a service instance (≈tens to hundreds per instance)

| Column | Links to | Meaning |
|---|---|---|
| id (key) | | |
| service_instance_id | → service_instances.id | What was deployed |
| server_id | → servers.id | Where it ran. Copied from the instance at deploy time on purpose, so history survives a move. |
| status | | `queued`, `building`, `deploying`, `active`, `failed`, `crashed`, `rolled_back` |
| image_ref | | Exact image |
| image_digest | | Exact image |
| commit_sha | | Source commit |
| configuration_snapshot | | The resolved configuration it ran with (exists today), so rollback restores config too |

### deployment_slots: the blue and green copies of a service instance (2 per instance)

| Column | Links to | Meaning |
|---|---|---|
| id (key) | | |
| service_instance_id | → service_instances.id | Owner |
| color | | `blue` or `green` |
| deployment_id | → deployments.id | What is running in this slot |
| host_port | | `127.0.0.1` port the edge or local proxy forwards to |
| status | | `active` or `standby`. Standby is the instant rollback target. |

### domains: public names and TCP ports (≈1–3 per instance)

| Column | Links to | Meaning |
|---|---|---|
| id (key) | | |
| service_instance_id | → service_instances.id | What it routes to |
| kind | | `generated`, `custom` or `tcp` |
| hostname | | e.g. `api-production-billing.apps.<ourdomain>`, or a customer domain |
| target_port | | Container port inside the Compose service |
| compose_service | | Which Compose service receives the traffic |
| edge_port | | Only for `tcp`: the public port on the edge, unique |
| verification_token | | Only for `custom`: expected value of the `dm-verify=` TXT record |
| status | | `pending_dns`, `active` or `failed` |

### usage_samples: what each container really used (≈1 per container per minute)

| Column | Links to | Meaning |
|---|---|---|
| server_id | → servers.id | Machine |
| service_instance_id | → service_instances.id | Container's owner |
| sampled_at | | Minute |
| cpu | | vCPUs used |
| memory_mb | | Memory used |
| network_bytes | | Bytes in and out |

The cost of a service instance for a period is: its server's `hourly_price_usd` × hours × its share
of the server (its `cpu_limit` over the server's `vcpus`). Rightsizing compares `usage_samples`
with the limits.

### Unchanged

`deployment_logs`, `build_runs`, `container_registries`, `connector_accounts`, `audit_events` and
`server_dev_sudo_users` stay as they are.

### Worked example

The **billing** project has an `api` (GitHub, Compose) and `postgres` (image + volume), in
**production** on AWS and a **PR #42 preview** on GCP spot.

| Table | Rows | What they are |
|---|---|---|
| cloud_accounts | 2 | prod AWS (`us-east-1`), previews GCP (`us-central1`) |
| servers | 3 | AWS `t3.large` on a Savings Plan (app), AWS `t3.small` (edge), GCP `e2-standard-2` spot (app) |
| projects | 1 | billing |
| environments | 2 | production; pr-42 with `source_environment_id` = production, `expires_at` = 7 days, `sleep_when_idle` |
| services | 2 | api, postgres |
| service_instances | 4 | api and postgres in each environment. Production is placed on the AWS app server, pr-42 on the GCP spot server. |
| variables | 2 | `DATABASE_URL=postgres://…@${{postgres.DM_PRIVATE_DOMAIN}}:5432/billing`, copied as text into pr-42 so it resolves to pr-42's own postgres |
| changes | 2 | production: "raise api memory to 1 GB" (applied). pr-42: the copy of production (applied) |
| domains | 2 | `api-production-billing.apps…` and `api-pr-42-billing.apps…` |
| deployments | 5 | api ×2 in production (one rolled back), api ×1 and postgres ×1 in pr-42, postgres ×1 in production |
| deployment_slots | 8 | blue and green for each of the 4 instances |
| usage_samples | ≈5.8k/day | 4 containers × 1,440 minutes |

Merging PR #42 deletes the pr-42 environment, its 2 instances, slots and domains. That GCP spot server
stops costing money once nothing is placed on it.

## 5. Build order

1. **Model split.** Split `applications` into `services` + `service_instances`, merge the variable tables into `variables`, and rename proxy routes to `domains`. This needs a new migration; the UI canvas already shows one environment at a time.
2. **Edge and generated domains:**
   - an edge server role;
   - wildcard DNS;
   - Caddy on-demand TLS with an `ask` endpoint and TXT verification;
   - proxy config persisted on every server.
3. **Provisioning on AWS and GCP.** `cloud_accounts`; create VMs through the EC2 and Compute Engine APIs with a cloud-init that installs Docker and joins the tailnet (`tailscale up --ssh --advertise-tags=…`, auth key from Doppler). App VMs get no public IP and no inbound rules.
4. **Cost.**
   - Instance prices, Compose resource limits, `usage_samples` from `docker stats`.
   - Cost per service, project and environment in the UI.
   - Project budgets that alert.
5. **Environments like Railway.** Staged `changes`, copy an environment, PR previews on the cheapest pool with sleep and expiry.
6. **Safer deploys.** Keep health-checking after go-live and switch back to the standby slot automatically.

## 6. Still unknown about Railway

How it detects the listening port, its TCP-proxy port range, its private IPv4 range, the exact order of
overlap and SIGTERM, whether sleeping services are billed, which registry stores images and for how
long, and whether the environment JSON is stored or derived. None of these block the design above.
