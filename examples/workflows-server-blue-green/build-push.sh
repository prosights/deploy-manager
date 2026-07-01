#!/usr/bin/env bash
set -euo pipefail

if [ -z "${IMAGE_REPO:-}" ]; then
  echo "IMAGE_REPO is required, for example us-docker.pkg.dev/project/repo/workflows-server" >&2
  exit 1
fi

TAG="${TAG:-$(date +%Y%m%d%H%M%S)}"
PLATFORM="${PLATFORM:-linux/amd64}"
IMAGE="${IMAGE_REPO}:${TAG}"

docker buildx build \
  --platform "${PLATFORM}" \
  --build-arg "APP_VERSION=${TAG}" \
  -t "${IMAGE}" \
  --push \
  .

docker buildx imagetools inspect "${IMAGE}"

echo
echo "Pushed ${IMAGE}"
