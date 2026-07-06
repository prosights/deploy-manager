#!/usr/bin/env bash
set -euo pipefail

users_file="${1:-ops/dev-sudo-users.txt}"

if [[ ! -f "$users_file" ]]; then
  echo "users file not found: $users_file" >&2
  exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo -- "$0" "$users_file"
fi

if ! getent group docker >/dev/null; then
  groupadd --system docker
fi

if ! getent group deployers >/dev/null; then
  groupadd --system deployers
fi

sudoers_file="/etc/sudoers.d/90-prosights-devs"
tmp_sudoers="$(mktemp)"
old_users="$(mktemp)"
desired_users="$(mktemp)"
trap 'rm -f "$tmp_sudoers" "$old_users" "$desired_users"' EXIT

if [[ -f "$sudoers_file" ]]; then
  awk '/^[a-z_][a-z0-9_-]* ALL=\(ALL\) NOPASSWD:ALL$/ { print $1 }' "$sudoers_file" >"$old_users"
fi

while IFS= read -r raw_user || [[ -n "$raw_user" ]]; do
  user="${raw_user%%#*}"
  user="${user//[[:space:]]/}"

  if [[ -z "$user" ]]; then
    continue
  fi

  if [[ ! "$user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
    echo "invalid Linux username: $user" >&2
    exit 1
  fi

  printf '%s\n' "$user" >>"$desired_users"

  if ! id "$user" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "$user"
  fi

  usermod -aG sudo,docker,deployers "$user"
  printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$user" >>"$tmp_sudoers"
done <"$users_file"

while IFS= read -r old_user || [[ -n "$old_user" ]]; do
  if [[ -z "$old_user" ]] || grep -Fxq "$old_user" "$desired_users"; then
    continue
  fi
  if id "$old_user" >/dev/null 2>&1; then
    gpasswd -d "$old_user" sudo >/dev/null 2>&1 || true
    gpasswd -d "$old_user" docker >/dev/null 2>&1 || true
    gpasswd -d "$old_user" deployers >/dev/null 2>&1 || true
  fi
done <"$old_users"

install -o root -g root -m 0440 "$tmp_sudoers" "$sudoers_file"
visudo -cf "$sudoers_file"
