package httpapi

import (
	"net/http"
	"strings"

	"deploy-manager/internal/db"
	"deploy-manager/internal/dockerx"

	"github.com/jackc/pgx/v5/pgtype"
)

func (s Server) listServers(w http.ResponseWriter, r *http.Request) {
	servers, err := s.queries.ListServers(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, servers)
}

func (s Server) createServer(w http.ResponseWriter, r *http.Request) {
	var input db.CreateServerParams
	if err := readJSON(w, r, &input); err != nil {
		writeError(w, err)
		return
	}
	input, err := normalizeCreateServer(input)
	if err != nil {
		writeError(w, err)
		return
	}

	server, err := s.queries.CreateServerWithSSHInventory(r.Context(), db.CreateServerWithSSHInventoryParams(input))
	if err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "server.create", "server", uuidString(server.ID), server.Name, serverCreateAuditMetadata(server.Hostname, server.ConnectionMode, server.ProxyType, server.SshKeyPath))
	writeJSON(w, http.StatusCreated, server)
}

func normalizeCreateServer(input db.CreateServerParams) (db.CreateServerParams, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Hostname = strings.TrimSpace(input.Hostname)
	input.SshUser = strings.TrimSpace(input.SshUser)
	input.ConnectionMode = strings.TrimSpace(input.ConnectionMode)
	input.ProxyType = strings.TrimSpace(input.ProxyType)
	input.SshKeyPath.String = strings.TrimSpace(input.SshKeyPath.String)

	if input.SshUser == "" {
		input.SshUser = "root"
	}
	if input.SshPort == 0 {
		input.SshPort = 22
	}
	if input.ConnectionMode == "" {
		input.ConnectionMode = "direct_ssh"
	}
	if input.ProxyType == "" {
		input.ProxyType = "caddy"
	}
	input.SshKeyPath = blankTextAsNull(input.SshKeyPath)
	if input.Name == "" || input.Hostname == "" {
		return input, validationError("name and hostname are required")
	}
	if hasControlCharacters(input.Name, input.Hostname, input.SshUser, input.SshKeyPath.String, input.ConnectionMode) {
		return input, validationError("server identity fields cannot contain control characters")
	}
	if !validConnectionMode(input.ConnectionMode) {
		return input, validationError("connection_mode must be direct_ssh or tailscale_ssh")
	}
	if err := validateServerSSHKeyPath(input.ConnectionMode, input.SshKeyPath.String, input.SshKeyPath.Valid); err != nil {
		return input, validationError(err.Error())
	}
	if input.SshPort < 1 || input.SshPort > 65535 {
		return input, validationError("ssh_port must be between 1 and 65535")
	}
	if _, err := dockerx.BuildSSHHost(input.SshUser, input.Hostname, input.SshPort); err != nil {
		return input, validationError(err.Error())
	}
	if !validProxyType(input.ProxyType) {
		return input, validationError("proxy_type must be caddy, traefik, or none")
	}
	return input, nil
}

func validConnectionMode(connectionMode string) bool {
	switch connectionMode {
	case "direct_ssh", "tailscale_ssh":
		return true
	default:
		return false
	}
}

func validProxyType(proxyType string) bool {
	switch proxyType {
	case "caddy", "traefik", "none":
		return true
	default:
		return false
	}
}

func validateServerSSHKeyPath(connectionMode string, value string, valid bool) error {
	if connectionMode == "tailscale_ssh" {
		if valid {
			return validationError("ssh_key_path must be empty for tailscale_ssh")
		}
		return nil
	}
	if !valid {
		return validationError("ssh_key_path is required for direct_ssh")
	}
	return validateSSHKeyPath(value)
}

func validateSSHKeyPath(value string) error {
	if !strings.HasPrefix(value, "/") && !strings.HasPrefix(value, "~/") {
		return validationError("ssh_key_path must be absolute or home-relative")
	}
	if strings.Contains(value, "//") {
		return validationError("ssh_key_path cannot contain empty path segments")
	}
	for _, segment := range strings.Split(value, "/") {
		if segment == ".." {
			return validationError("ssh_key_path cannot contain parent directory segments")
		}
	}
	return nil
}

func serverCreateAuditMetadata(hostname string, connectionMode string, proxyType string, sshKeyPath pgtype.Text) map[string]any {
	return map[string]any{
		"hostname":              hostname,
		"connection_mode":       connectionMode,
		"proxy_type":            proxyType,
		"ssh_inventory_tracked": sshKeyPath.Valid,
	}
}
