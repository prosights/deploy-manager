# Deploy Manager

Deploy Manager is a slim internal control plane for remote server management and Docker Compose deployments.

It registers SSH-accessible servers, validates connectivity, monitors resource health, deploys application stacks, manages Caddy or Traefik proxy routes, streams deployment logs, and keeps an inventory of credentials with permission and usage visibility. It does not manage secret values directly; systems such as Doppler are integrated through connectors.

## Stack

- Go backend with chi, sqlc, PostgreSQL, Redis, SSH, Docker SDK, and SSE log streaming.
- React + TypeScript frontend built with Vite, Tailwind CSS v4, TanStack Query, TanStack Router, and Zustand.
- Docker Compose for local development.
- Single production image with the Go server serving built frontend assets.

## Architecture

This Mermaid diagram is intentionally kept in the README so it is easy to move, edit, and render directly in GitHub.

```mermaid
flowchart TB
    operator["Operator"]
    github["GitHub webhook\npush events"]

    subgraph browser["Browser"]
        spa["React SPA\nVite + TanStack Router"]
        routes["UI routes\noverview, projects, servers, applications, deployments, credentials, connectors, proxy, audit, settings"]
        query["TanStack Query API client"]
        spa --> routes
        routes --> query
    end

    subgraph app["Go server binary"]
        static["Static asset handler\nserves web/dist and SPA fallback"]
        api["chi HTTP API\n/api/*"]
        health["health and readiness checks"]
        settings["settings, audit, projects, environments"]
        inventory["servers, applications, credentials, connectors, object storage"]
        deploy_api["deployment endpoints\ncreate, cancel, retry, logs, SSE events"]
        proxy_api["proxy route endpoints\ncreate and apply"]
        github_api["GitHub webhook handler\nHMAC verification"]

        api --> health
        api --> settings
        api --> inventory
        api --> deploy_api
        api --> proxy_api
        api --> github_api
    end

    subgraph data["State and generated data"]
        postgres["PostgreSQL\nsqlc queries + migrations"]
        redis["Redis\ndeployment queue + log fanout"]
        logbus["Deployment LogBus\nSSE publish/subscribe"]
    end

    subgraph connectors["Connector boundary"]
        connector_registry["Built-in connector registry"]
        github_connector["GitHub connector\ncredential inventory"]
        doppler["Doppler connector\nruntime variables"]
        slack_connector["Slack connector\ncredential inventory"]
        resend_connector["Resend connector\ncredential inventory"]
        storage_connectors["Object storage connectors\nS3 + GCS inventory"]

        connector_registry --> github_connector
        connector_registry --> doppler
        connector_registry --> slack_connector
        connector_registry --> resend_connector
        connector_registry --> storage_connectors
    end

    subgraph worker["Deployment worker"]
        queue["Redis-backed deployment queue\nrecovery on startup"]
        runner["Deployment runner"]
        remote_plan["Remote step planner\nvalidate target, render env, compose commands"]
        ssh["SSH client\nknown_hosts enforced"]
        proxy_manager["Proxy manager\nCaddy or Traefik commands"]
        notifier["Notifier\nSlack + Resend"]

        queue --> runner
        runner --> remote_plan
        runner --> ssh
        runner --> proxy_manager
        runner --> notifier
    end

    subgraph target["Remote deployment target"]
        vm["SSH-accessible VM"]
        repo["Application repository\nclone, fetch, checkout"]
        envfile["Runtime .env\nwritten with restricted permissions"]
        compose["Docker Compose\nconfig, pull, up"]
        proxy["Caddy or Traefik\nroute application traffic"]
        healthcheck["Optional health check\nblue-green promotion gate"]

        vm --> repo
        vm --> envfile
        vm --> compose
        vm --> proxy
        vm --> healthcheck
    end

    operator --> spa
    spa --> static
    query --> api
    github --> github_api

    settings --> postgres
    inventory --> postgres
    deploy_api --> postgres
    proxy_api --> postgres
    github_api --> postgres

    deploy_api --> queue
    github_api --> queue
    queue --> redis
    runner --> postgres
    runner --> logbus
    logbus --> redis
    deploy_api --> logbus
    logbus -->|"SSE /api/deployments/{id}/events"| query

    inventory --> connector_registry
    deploy_api --> doppler
    doppler --> remote_plan

    ssh --> vm
    proxy_manager --> ssh
    notifier --> slack_connector
    notifier --> resend_connector

    postgres -. "stores projects, environments, applications, servers, deployments, logs, proxy routes, credentials, connector accounts, audit events" .- app
```

Primary request flow:

1. The React SPA calls `/api/*` endpoints on the Go server.
2. API handlers validate input, persist state through sqlc/PostgreSQL, and enqueue deployment work in Redis when needed.
3. The deployment worker recovers queued/interrupted work on startup, pops Redis jobs, loads the target from PostgreSQL, syncs Doppler runtime variables, and executes a validated remote Docker Compose plan over SSH.
4. Deployment output is stored in PostgreSQL, published through Redis-backed `LogBus`, and streamed to the UI over Server-Sent Events.
5. Connectors keep credential, permission, usage, runtime variable, and object-storage inventory behind explicit provider boundaries; Deploy Manager stores references and metadata, not private secret values.

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
