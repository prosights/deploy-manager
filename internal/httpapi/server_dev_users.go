package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"deploy-manager/internal/db"
	"deploy-manager/internal/sshutil"
	"deploy-manager/internal/stringutil"

	"github.com/go-chi/chi/v5"
)

const (
	devUsersFilePath          = "/srv/deploy-manager/ops/dev-sudo-users.txt"
	devUsersProvisionPath     = "/srv/deploy-manager/ops/provision-dev-sudo-users.sh"
	devUsersOperationTimeout  = 2 * time.Minute
	devUsersMaxUsernameLength = 32
)

var linuxUsernamePattern = regexp.MustCompile(`^[a-z_][a-z0-9_-]{0,31}$`)

type serverDevUsersResponse struct {
	Users      []string `json:"users"`
	Path       string   `json:"path"`
	ScriptPath string   `json:"script_path"`
}

type serverDevUserRequest struct {
	Username string `json:"username"`
}

type serverDevUserUpdateRequest struct {
	Username string `json:"username"`
}

func (s Server) listServerDevUsers(w http.ResponseWriter, r *http.Request) {
	server, err := s.serverForDevUserRequest(r)
	if err != nil {
		writeError(w, err)
		return
	}
	users, err := s.readServerDevUsers(r.Context(), server)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, serverDevUsersResponse{
		Users:      users,
		Path:       devUsersFilePath,
		ScriptPath: devUsersProvisionPath,
	})
}

func (s Server) addServerDevUser(w http.ResponseWriter, r *http.Request) {
	server, err := s.serverForDevUserRequest(r)
	if err != nil {
		writeError(w, err)
		return
	}
	var request serverDevUserRequest
	if err := readJSON(w, r, &request); err != nil {
		writeError(w, err)
		return
	}
	username, err := normalizeDevUsername(request.Username)
	if err != nil {
		writeError(w, err)
		return
	}
	users, err := s.readServerDevUsers(r.Context(), server)
	if err != nil {
		writeError(w, err)
		return
	}
	users = addDevUser(users, username)
	if err := s.applyAndPersistServerDevUsers(r.Context(), server, users); err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "server.dev_user.add", "server", uuidString(server.ID), server.Name, map[string]any{"username": username})
	writeJSON(w, http.StatusOK, serverDevUsersResponse{Users: users, Path: devUsersFilePath, ScriptPath: devUsersProvisionPath})
}

func (s Server) updateServerDevUser(w http.ResponseWriter, r *http.Request) {
	server, oldUsername, err := s.serverAndDevUsername(r)
	if err != nil {
		writeError(w, err)
		return
	}
	var request serverDevUserUpdateRequest
	if err := readJSON(w, r, &request); err != nil {
		writeError(w, err)
		return
	}
	newUsername, err := normalizeDevUsername(request.Username)
	if err != nil {
		writeError(w, err)
		return
	}
	users, err := s.readServerDevUsers(r.Context(), server)
	if err != nil {
		writeError(w, err)
		return
	}
	updated, err := replaceDevUser(users, oldUsername, newUsername)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.applyAndPersistServerDevUsers(r.Context(), server, updated); err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "server.dev_user.update", "server", uuidString(server.ID), server.Name, map[string]any{"old_username": oldUsername, "username": newUsername})
	writeJSON(w, http.StatusOK, serverDevUsersResponse{Users: updated, Path: devUsersFilePath, ScriptPath: devUsersProvisionPath})
}

func (s Server) deleteServerDevUser(w http.ResponseWriter, r *http.Request) {
	server, username, err := s.serverAndDevUsername(r)
	if err != nil {
		writeError(w, err)
		return
	}
	users, err := s.readServerDevUsers(r.Context(), server)
	if err != nil {
		writeError(w, err)
		return
	}
	updated := removeDevUser(users, username)
	if err := s.applyAndPersistServerDevUsers(r.Context(), server, updated); err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "server.dev_user.delete", "server", uuidString(server.ID), server.Name, map[string]any{"username": username})
	writeJSON(w, http.StatusOK, serverDevUsersResponse{Users: updated, Path: devUsersFilePath, ScriptPath: devUsersProvisionPath})
}

func (s Server) applyServerDevUsers(w http.ResponseWriter, r *http.Request) {
	server, err := s.serverForDevUserRequest(r)
	if err != nil {
		writeError(w, err)
		return
	}
	users, err := s.readServerDevUsers(r.Context(), server)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.writeAndApplyServerDevUsers(r.Context(), server, users); err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "server.dev_user.apply", "server", uuidString(server.ID), server.Name, map[string]any{"user_count": len(users)})
	writeJSON(w, http.StatusOK, serverDevUsersResponse{Users: users, Path: devUsersFilePath, ScriptPath: devUsersProvisionPath})
}

func (s Server) serverForDevUserRequest(r *http.Request) (db.Server, error) {
	serverID, err := parseUUIDParam(r, "serverID")
	if err != nil {
		return db.Server{}, err
	}
	server, err := s.queries.GetServer(r.Context(), serverID)
	if err != nil {
		return db.Server{}, serverLookupError(err)
	}
	if !canConnectToServerForDevUsers(server) {
		return db.Server{}, validationError("server must have SSH access configured")
	}
	return server, nil
}

func (s Server) serverAndDevUsername(r *http.Request) (db.Server, string, error) {
	server, err := s.serverForDevUserRequest(r)
	if err != nil {
		return db.Server{}, "", err
	}
	username, err := normalizeDevUsername(chiURLParam(r, "username"))
	if err != nil {
		return db.Server{}, "", err
	}
	return server, username, nil
}

func canConnectToServerForDevUsers(server db.Server) bool {
	return server.ConnectionMode == "tailscale_ssh" || server.SshKeyPath.Valid
}

func (s Server) readServerDevUsers(ctx context.Context, server db.Server) ([]string, error) {
	rows, err := s.queries.ListServerDevSudoUsers(ctx, server.ID)
	if err != nil {
		return nil, err
	}
	users := make([]string, 0, len(rows))
	for _, row := range rows {
		users = append(users, row.Username)
	}
	return users, nil
}

func (s Server) applyAndPersistServerDevUsers(ctx context.Context, server db.Server, users []string) error {
	if err := s.writeAndApplyServerDevUsers(ctx, server, users); err != nil {
		return err
	}
	return s.persistServerDevUsers(ctx, server, users)
}

func (s Server) persistServerDevUsers(ctx context.Context, server db.Server, users []string) error {
	return s.queries.ReplaceServerDevSudoUsers(ctx, db.ReplaceServerDevSudoUsersParams{
		ServerID:  server.ID,
		Usernames: users,
	})
}

func (s Server) writeAndApplyServerDevUsers(ctx context.Context, server db.Server, users []string) error {
	command := remoteDevUsersApplyCommand(server, users)
	runner := s.remoteCommandRunner()
	if server.ConnectionMode == sshutil.ConnectionModeTailscaleSSH && sshutil.IsLocalTailscaleHost(ctx, server.Hostname) {
		command = localHostDevUsersApplyCommand(server, users)
		runner = localCommandRunner{}
	}

	commandCtx, cancel := context.WithTimeout(ctx, devUsersOperationTimeout)
	defer cancel()
	_, err := runner.Run(commandCtx, server, command)
	return err
}

func remoteDevUsersApplyCommand(server db.Server, users []string) string {
	return "bash -lc " + stringutil.ShellQuote(devUsersApplyScript(server, users))
}

func devUsersApplyScript(server db.Server, users []string) string {
	command := strings.Join([]string{
		"set -euo pipefail",
		"sudo groupadd --system deployers 2>/dev/null || true",
		"sudo install -d -o " + stringutil.ShellQuote(server.SshUser) + " -g deployers -m 2775 /srv/deploy-manager/ops",
		"tmp_users=$(mktemp)",
		"tmp_script=$(mktemp)",
		"cat > \"$tmp_users\" <<'PROSIGHTS_USERS'",
		renderDevUsersFile(users) + "PROSIGHTS_USERS",
		"cat > \"$tmp_script\" <<'PROSIGHTS_SCRIPT'",
		devUsersProvisionScript + "PROSIGHTS_SCRIPT",
		"sudo install -o " + stringutil.ShellQuote(server.SshUser) + " -g deployers -m 0664 \"$tmp_users\" " + stringutil.ShellQuote(devUsersFilePath),
		"sudo install -o " + stringutil.ShellQuote(server.SshUser) + " -g deployers -m 0775 \"$tmp_script\" " + stringutil.ShellQuote(devUsersProvisionPath),
		"rm -f \"$tmp_users\" \"$tmp_script\"",
		stringutil.ShellQuote(devUsersProvisionPath) + " " + stringutil.ShellQuote(devUsersFilePath),
	}, "\n")
	return command
}

func localHostDevUsersApplyCommand(server db.Server, users []string) string {
	hostScript := strings.Join([]string{
		"set -eu",
		"install -d -m 0755 /host/srv/deploy-manager/ops",
		"cat > /host" + devUsersFilePath + " <<'PROSIGHTS_USERS'",
		renderDevUsersFile(users) + "PROSIGHTS_USERS",
		"cat > /host" + devUsersProvisionPath + " <<'PROSIGHTS_SCRIPT'",
		devUsersProvisionScript + "PROSIGHTS_SCRIPT",
		"chmod 0664 /host" + devUsersFilePath,
		"chmod 0775 /host" + devUsersProvisionPath,
		"chroot /host " + stringutil.ShellQuote(devUsersProvisionPath) + " " + stringutil.ShellQuote(devUsersFilePath),
		"chroot /host chown -R " + stringutil.ShellQuote(server.SshUser) + ":deployers /srv/deploy-manager/ops",
		"chroot /host chmod 2775 /srv/deploy-manager/ops",
	}, "\n")
	return strings.Join([]string{
		"docker run --rm --privileged -i -v /:/host alpine:3.23 sh -s <<'PROSIGHTS_HOST_APPLY'",
		hostScript,
		"PROSIGHTS_HOST_APPLY",
	}, "\n")
}

func parseDevUsersFile(content string) ([]string, error) {
	seen := map[string]bool{}
	users := []string{}
	for _, line := range strings.Split(content, "\n") {
		value := strings.TrimSpace(strings.SplitN(line, "#", 2)[0])
		if value == "" {
			continue
		}
		username, err := normalizeDevUsername(value)
		if err != nil {
			return nil, err
		}
		if seen[username] {
			continue
		}
		seen[username] = true
		users = append(users, username)
	}
	sort.Strings(users)
	return users, nil
}

func normalizeDevUsername(username string) (string, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return "", validationError("username is required")
	}
	if len(username) > devUsersMaxUsernameLength {
		return "", validationError("username must be 32 characters or fewer")
	}
	if !linuxUsernamePattern.MatchString(username) {
		return "", validationError("username must be a valid Linux username")
	}
	return username, nil
}

func addDevUser(users []string, username string) []string {
	for _, existing := range users {
		if existing == username {
			return users
		}
	}
	users = append(users, username)
	sort.Strings(users)
	return users
}

func replaceDevUser(users []string, oldUsername string, newUsername string) ([]string, error) {
	found := false
	next := make([]string, 0, len(users))
	for _, user := range users {
		if user == oldUsername {
			found = true
			next = addDevUser(next, newUsername)
			continue
		}
		next = addDevUser(next, user)
	}
	if !found {
		return nil, notFoundError(fmt.Sprintf("username %q not found", oldUsername))
	}
	return next, nil
}

func removeDevUser(users []string, username string) []string {
	next := users[:0]
	for _, user := range users {
		if user != username {
			next = append(next, user)
		}
	}
	return next
}

func renderDevUsersFile(users []string) string {
	normalized := make([]string, 0, len(users))
	for _, user := range users {
		if username, err := normalizeDevUsername(user); err == nil {
			normalized = addDevUser(normalized, username)
		}
	}
	var builder strings.Builder
	builder.WriteString("# One Linux username per line.\n")
	builder.WriteString("# Deploy Manager provisions these users with sudo, docker, deployers,\n")
	builder.WriteString("# and passwordless sudo access on this server.\n")
	for _, user := range normalized {
		builder.WriteString(user)
		builder.WriteByte('\n')
	}
	return builder.String()
}

func chiURLParam(r *http.Request, key string) string {
	return strings.TrimSpace(chi.URLParam(r, key))
}

const devUsersProvisionScript = `#!/usr/bin/env bash
set -euo pipefail

users_file="${1:-/srv/deploy-manager/ops/dev-sudo-users.txt}"

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
`
