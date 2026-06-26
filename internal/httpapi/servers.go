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
	s.audit(r, "server.create", "server", uuidString(server.ID), server.Name, serverCreateAuditMetadata(server.Hostname, server.ProxyType, server.SshKeyPath))
	writeJSON(w, http.StatusCreated, server)
}

func normalizeCreateServer(input db.CreateServerParams) (db.CreateServerParams, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Hostname = strings.TrimSpace(input.Hostname)
	input.SshUser = strings.TrimSpace(input.SshUser)
	input.ProxyType = strings.TrimSpace(input.ProxyType)
	input.SshKeyPath.String = strings.TrimSpace(input.SshKeyPath.String)

	if input.SshUser == "" {
		input.SshUser = "root"
	}
	if input.SshPort == 0 {
		input.SshPort = 22
	}
	if input.ProxyType == "" {
		input.ProxyType = "caddy"
	}
	input.SshKeyPath = blankTextAsNull(input.SshKeyPath)
	if input.Name == "" || input.Hostname == "" || !input.SshKeyPath.Valid {
		return input, validationError("name, hostname, and ssh_key_path are required")
	}
	if hasControlCharacters(input.Name, input.Hostname, input.SshUser, input.SshKeyPath.String) {
		return input, validationError("server identity fields cannot contain control characters")
	}
	if err := validateSSHKeyPath(input.SshKeyPath.String); err != nil {
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

func validProxyType(proxyType string) bool {
	switch proxyType {
	case "caddy", "traefik", "none":
		return true
	default:
		return false
	}
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

func serverCreateAuditMetadata(hostname string, proxyType string, sshKeyPath pgtype.Text) map[string]any {
	return map[string]any{
		"hostname":              hostname,
		"proxy_type":            proxyType,
		"ssh_inventory_tracked": sshKeyPath.Valid,
	}
}
