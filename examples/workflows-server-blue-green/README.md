# Workflows Server Blue-Green Sample

This is a tiny website plus backend for testing Deploy Manager blue-green rollout and rollback against a remote Docker server.

## Build and Push

```bash
cd examples/workflows-server-blue-green
IMAGE_REPO=us-docker.pkg.dev/YOUR_PROJECT/YOUR_REPO/workflows-server TAG=v1 bash build-push.sh
IMAGE_REPO=us-docker.pkg.dev/YOUR_PROJECT/YOUR_REPO/workflows-server TAG=v2 bash build-push.sh
```

Use the pushed image ref as `image_ref` in Deploy Manager, for example:

```text
us-docker.pkg.dev/YOUR_PROJECT/YOUR_REPO/workflows-server:v1
```

## Remote Compose Contract

Copy `compose.remote.yml` to the application remote directory as `docker-compose.yml`.

For blue-green testing, configure these runtime variables on the remote host or through Deploy Manager/Doppler:

```text
BLUE_DEPLOY_PORT=3101
GREEN_DEPLOY_PORT=3102
APP_VERSION=v1 or v2
```

Deploy Manager writes `DEPLOY_IMAGE`, `DEPLOY_COLOR`, and `DEPLOY_PORT` during image deployments. The compose project name is color-specific, so blue and green containers can run at the same time.

Use this application health check URL:

```text
http://127.0.0.1:{port}/healthz?color={color}
```

## Proxy Route

Create a proxy route linked to the application:

```text
upstream_url       http://127.0.0.1:3101
blue_upstream_url  http://127.0.0.1:3101
green_upstream_url http://127.0.0.1:3102
```

On deploy, Deploy Manager starts the inactive color, health-checks it, updates the proxy to that color, and keeps the previous color running as standby.

Rollback flips the proxy back to the standby color.

## Test Loop

1. Push `v1`.
2. Queue a blue-green deployment with `image_ref` set to the `v1` image.
3. Open the public route and confirm the page shows the active color/version.
4. Push `v2`.
5. Queue another blue-green deployment with `image_ref` set to `v2`.
6. Confirm both containers exist on the remote server:

```bash
docker ps --filter 'name=workflows-server-'
```

7. Press Rollback in Deploy Manager.
8. Refresh the public route and confirm traffic is back on the previous color/version.
