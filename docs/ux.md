# Making Paddock easy to use

Status: proposal, 2026-10-20. Companion to [railway-model.md](railway-model.md), which covers the
data model and infrastructure. This document covers what people see and do.

Method: I ran the current app locally with demo data (two projects, a production and a staging
environment, an AWS and a GCP server, four deployments, one failed) and walked through every
screen. I compared each task with how Railway handles it, using Railway's docs.

## 1. What is hard today

| # | What the user sees | Where | Why it hurts |
|---|---|---|---|
| 1 | One thing has four names: the canvas card is a "service", the Variables tab calls it a "stack", the API calls it an "application", and the containers inside it are also "services". | Canvas, service panel, Variables | Users can't tell what a setting applies to. |
| 2 | Three save buttons in one panel ("Save stack", "Save api", "Save settings"), each with a note that saving "marks the Compose stack for redeployment". Deploying is a separate button. | Service panel | Nobody knows whether a change is live, pending, or lost. |
| 3 | "Add a health check containing {color} and {port} before deploying." The field wants `http://127.0.0.1:{port}/healthz?color={color}`. | Deployments tab, Settings | Exposes our blue/green internals. Railway asks for a path, such as `/healthz`. |
| 4 | Users must type a remote directory (`/opt/apps/billing-api`) and pick a server. The server can't be changed afterwards. | Settings | These are placement details the platform should decide. |
| 5 | The panel header shows `https://billing.prosights.co`, while Networking says "No domains yet". | Service panel | There are two sources of truth for domains, and they disagree. |
| 6 | Staging's failed deploy is invisible on the canvas. The project card just says "failed", without saying which environment. | Projects, canvas | The most important fact on the page is hidden behind a dropdown. |
| 7 | "Add service" accepts only a GitHub repo with a compose file. There's no Docker image, no database template, no empty service. | Add service | Adding Postgres means writing a compose file in a repo. |
| 8 | Each variables level (project-shared, stack-shared and per-container) has its own Doppler project and config pickers, and each is saved separately. | Variables | Users have to work out the precedence themselves. Most only want "this environment uses Doppler config `prd`". |
| 9 | Deployment rows show the deployment ID (`f4ceb25d`) where people expect the commit SHA (`a1b2c3d`). | Deployments tab | People read it as a commit and look in the wrong place. |
| 10 | The Deployments table has no environment column, and every row repeats "Blue-Green". At 1280 px it overflows, cutting off the SHA and action columns. | /deployments | The useful columns get hidden while the noise stays. |
| 11 | A failed deploy shows "FAILED" with no reason. The user has to open the logs and search. | Everywhere | Explaining what went wrong is the platform's job. |
| 12 | Servers are typed in by hand ("Register server"). The page doesn't show what runs on each server, what it costs, or whether it is too big. | /servers | The promise of controlling cost doesn't appear anywhere in the UI. |
| 13 | The sidebar has six top-level pages. Notifications, Connectors and Audit are setup pages that are used rarely. | Sidebar | Daily work gets the same weight as one-time setup. |

## 2. What makes Railway feel easy (from their docs)

1. **A canvas that shows the truth.** Each card shows its status, its URL and its latest deploy.
   The environment switcher lives on the canvas.
2. **Staged changes.** Every edit, anywhere, goes into one change set. A banner on the canvas shows
   "N changes", staged items turn purple, "Details" shows an old→new diff, and one **Deploy**
   button applies everything with an optional message (`deployments_staged-changes.md`). There is
   no save-versus-deploy confusion because there is only one button.
3. **One "New" menu, and ⌘K.** The menu offers a GitHub repo, a database, a template, a Docker
   image or an empty service. Everything is also reachable from the command palette
   (`services.md`, `volumes.md`).
4. **Ask for intent, not mechanism.** The health check is a path, the domain is "Generate domain",
   and the region is a dropdown.
5. **Variables that help.** There is a raw `.env` editor, suggested variables taken from the repo's
   `.env.example`, and autocomplete for references such as `${{postgres.DATABASE_URL}}`
   (`variables.md`).

## 3. The rebuilt experience

### 3.1 One vocabulary

| Word | Meaning | Replaces |
|---|---|---|
| **Project** | A product, such as Billing. | — |
| **Environment** | production, staging, or `pr-42`. | — |
| **Service** | One card on the canvas: a repo, an image or a database. Each one is a Compose stack underneath. | application, stack |
| **Container** | One entry inside the service's compose file, such as `api` or `worker`. | "compose service" |
| **Server** | A VM on AWS or GCP. | — |

This vocabulary appears in UI copy, API paths and table names (`services` and `service_instances`
in railway-model.md §4). The words "stack" and "application" disappear.

### 3.2 Navigation

The sidebar shrinks from six items to four:

- **Projects**
- **Activity:** deployments plus audit, as one feed.
- **Infrastructure:** servers, edges, cloud accounts and cost.
- **Settings:** connectors and notifications.

Daily work happens on the canvas, and setup pages move out of the way.

### 3.3 The canvas is the home page

- **Environment tabs** replace the dropdown, and each tab has a status dot (`production ●`,
  `staging ●`). A failure anywhere is visible at once.
- **Each card** shows:
  - its name;
  - its URL, or "private";
  - status and age ("Healthy · deployed 2h ago · a1b2c3d");
  - where it runs ("AWS us-east-1");
  - its monthly cost ("$11/mo").
  A failed card turns red and shows a one-line reason.
- **Lines between cards** come from reference variables (`${{postgres.DATABASE_URL}}`), so the
  diagram draws itself.
- **The staged-changes bar** pins to the bottom of the canvas whenever anything is pending:
  "3 changes · Details · Discard · **Deploy**". Every edit in every panel lands there, and there
  are no other save buttons.

### 3.4 Adding things: one menu and ⌘K

**+ New** offers:

- a GitHub repo, with its compose file detected as today;
- a Docker image;
- a database (Postgres or Redis), created as a service from a built-in compose template;
- an empty service.

⌘K reaches the same actions, plus "go to service…", "deploy…", "rollback…", "open console on…" and
"switch environment…".

### 3.5 The service panel

The tabs are **Deployments · Variables · Metrics · Settings**. Console moves into the panel header
as a button.

**Settings** asks for intent; Paddock fills in the mechanism.

| Today | Rebuilt |
|---|---|
| Health check URL with `{color}` and `{port}` | **Health check path:** `/healthz`. Paddock builds the URL for each slot. |
| Remote directory | Gone. It is derived as `/srv/<project>/<env>/<service>`. |
| Server, fixed at creation | **Runs on:** cloud, region and size, with the price beside each option. Moving is allowed; it is a normal staged change followed by a deploy. |
| "Run mode: Follow stack / Singleton" | A toggle on each container, **Run exactly one copy**, with the hint "for cron jobs and queue consumers". |
| Networking says "No domains yet" while the header shows a domain | A single **Domains** section. **Generate domain** is one click, and adding a custom domain shows the exact CNAME and TXT records to create and live verification. |

**Variables** become one table with these columns:

- **Name**
- **Value:** Doppler secrets show as `•••• from Doppler`.
- **Source:** Doppler, shared, or this service.
- **Applies to:** all containers, or chosen containers.

The Doppler project and config are chosen **once per environment**, not per stack and per
container. There is a raw `.env` editor for non-secret values; anything that looks like a secret is
rejected and pointed to Doppler, which keeps the rule in AGENTS.md. Names from the repo's
`.env.example` are suggested, and typing `${{` autocompletes references.

**Deployments** list commit SHAs and messages, not deployment IDs. A failed deploy expands in
place:

- the step that failed ("Health check `/healthz` returned 502 for 60 s");
- the last 20 log lines;
- **Retry**, **Roll back** and **Open full logs**.

After go-live, a strip reads "Watching health for 10 min · auto-rollback on". It makes our post-go-live
protection visible, which Railway doesn't have.

### 3.6 Infrastructure page

- **Servers.** Each row shows:
  - cloud and region;
  - size;
  - **$/month**;
  - CPU and memory use;
  - the services running on it;
  - a sizing hint ("Using 12% of 4 vCPU. Downsize to e2-small and save $24/mo").
- **New server** replaces "Register server". Pick AWS or GCP, a region and a size. The price is
  shown before anything is created, and the server joins Tailscale automatically.
- **Edges.** For each edge: its domains, certificate status and last config push.
- **Cost.** Spend this month and the month-end forecast, broken down by project and environment,
  with budget alerts.

### 3.7 First run

When nothing is set up yet, the empty canvas shows a three-step checklist:

1. Connect GitHub.
2. Add a server, or use an existing one.
3. Deploy your first service.

Each step links to the action itself, not to a settings page.

## 4. Where this beats Railway

- **Cost on the canvas.** Every card shows what it costs, and sizing hints turn the numbers into
  savings. Railway shows usage only on a separate billing page.
- **Choosing where to run is a price comparison.** The same service is quoted on AWS and GCP, on
  demand or spot.
- **Visible safety after deploy.** "Watching · auto-rollback on" doesn't exist on Railway, where
  health checks stop at go-live.
- **Secrets stay in Doppler.** Doppler values are shown as references. Railway's sealed variables
  still live inside Railway.
- **Failure reasons inline.** We know which step failed (pull, build, health check or proxy
  switch), so we say so.

## 5. Fix now, before the rebuild

These are defects in today's app. Each is small and none depends on the new data model.

1. Replace the `{color}`/`{port}` banner and field with a health check path. The backend expands
   the path to the full URL.
2. Show the commit SHA on deployment rows and the drawer title, not the deployment ID.
3. Use one source for domains: either show the proxy routes in the header, or move the legacy
   `domain` field into Networking.
4. Add an environment column to /deployments, drop the Strategy column, and stop the table
   overflowing at 1280 px.
5. Put a status dot on each option in the environment selector, and have the project card say
   which environment failed.
6. Show the failure reason (the last error event) on failed deployment rows.

## 6. Order of work

Each UX step follows a step in railway-model.md §5:

| railway-model.md step | UX delivered with it |
|---|---|
| 1. Split into services and service instances; merge variables | The vocabulary (§3.1), the single variables table (§3.5), the Doppler config picked once per environment |
| 2. Edge, generated domains, TLS | Generate domain, custom-domain verification, URLs on cards |
| 3. AWS/GCP provisioning with Tailscale | New server with prices, "Runs on" picker, the Infrastructure page |
| 4. Cost | $/mo on cards, sizing hints, cost and budgets |
| 5. Staged changes, environment copies, PR previews | Staged-changes bar and diff, environment tabs, "Duplicate environment" |
| 6. Health checks after go-live with auto-rollback | The "Watching · auto-rollback" strip, inline failure reasons |

These can ship at any time, independent of the rebuild: ⌘K, the + New menu (repo and image first),
the four-item sidebar, and the fixes in §5.
