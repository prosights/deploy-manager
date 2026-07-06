#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
archive="$(mktemp)"
trap 'rm -f "$archive"' EXIT

tar -C "$root_dir" -czf "$archive" \
  ops/dev-sudo-users.txt \
  ops/provision-dev-sudo-users.sh

sync_host() {
  local ssh_target="$1"

  scp "$archive" "${ssh_target}:/tmp/prosights-dev-users-ops.tgz"
  ssh "$ssh_target" 'set -euo pipefail
    sudo groupadd --system deployers 2>/dev/null || true
    sudo install -d -o ali_prosights_co -g deployers -m 2775 /srv/deploy-manager
    sudo tar -xzf /tmp/prosights-dev-users-ops.tgz -C /srv/deploy-manager
    sudo chown -R ali_prosights_co:deployers /srv/deploy-manager/ops
    sudo chmod 2775 /srv/deploy-manager/ops
    sudo chmod 664 /srv/deploy-manager/ops/dev-sudo-users.txt
    sudo chmod 775 /srv/deploy-manager/ops/provision-dev-sudo-users.sh
    /srv/deploy-manager/ops/provision-dev-sudo-users.sh /srv/deploy-manager/ops/dev-sudo-users.txt'
}

sync_host development
sync_host ali_prosights_co@internal
