package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"
	"unicode"

	"deploy-manager/internal/db"
	"deploy-manager/internal/sshutil"
)

const (
	serverCommandTimeout   = 30 * time.Second
	maxServerCommandLength = 1000
)

type remoteCommandRunner interface {
	Run(context.Context, db.Server, string) (string, error)
}

type sshRemoteCommandRunner struct {
	signer sshutil.SignerSource
}

type serverCommandRequest struct {
	Command string `json:"command"`
}

type serverCommandResponse struct {
	Output string `json:"output"`
	Error  string `json:"error,omitempty"`
}

func (s Server) runServerCommand(w http.ResponseWriter, r *http.Request) {
	serverID, err := parseUUIDParam(r, "serverID")
	if err != nil {
		writeError(w, err)
		return
	}

	var request serverCommandRequest
	if err := readJSON(w, r, &request); err != nil {
		writeError(w, err)
		return
	}
	command, err := normalizeServerCommand(request.Command)
	if err != nil {
		writeError(w, err)
		return
	}

	server, err := s.queries.GetServer(r.Context(), serverID)
	if err != nil {
		writeError(w, serverLookupError(err))
		return
	}
	if server.ConnectionMode != sshutil.ConnectionModeTailscaleSSH && (!server.SshKeyPath.Valid || strings.TrimSpace(server.SshKeyPath.String) == "") {
		writeError(w, validationError("server ssh_key_path is required for terminal access"))
		return
	}

	commandCtx, cancel := context.WithTimeout(r.Context(), serverCommandTimeout)
	defer cancel()
	output, runErr := s.remoteCommandRunner().Run(commandCtx, server, command)
	s.audit(r, "server.command", "server", uuidString(server.ID), server.Name, serverCommandAuditMetadata(output, runErr))

	writeJSON(w, http.StatusOK, serverCommandResponse{
		Output: output,
		Error:  errorString(runErr),
	})
}

func (s Server) remoteCommandRunner() remoteCommandRunner {
	if s.remoteCommands != nil {
		return s.remoteCommands
	}
	return sshRemoteCommandRunner{}
}

func (r sshRemoteCommandRunner) Run(ctx context.Context, server db.Server, command string) (string, error) {
	if server.ConnectionMode == sshutil.ConnectionModeTailscaleSSH {
		return sshutil.NewTailscaleSSHClient(server.Hostname, server.SshPort, server.SshUser).Run(ctx, command)
	}
	signerSource := r.signer
	if signerSource == nil {
		signerSource = sshutil.FileSigner{}
	}
	signer, err := signerSource.Signer(ctx, sshutil.ServerRef{
		Host:    server.Hostname,
		Port:    server.SshPort,
		User:    server.SshUser,
		KeyPath: server.SshKeyPath.String,
	})
	if err != nil {
		return "", err
	}
	return sshutil.NewClient(server.Hostname, server.SshPort, server.SshUser, signer).Run(ctx, command)
}

func normalizeServerCommand(command string) (string, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return "", validationError("command is required")
	}
	if len(command) > maxServerCommandLength {
		return "", validationError("command must be 1000 characters or fewer")
	}
	for _, char := range command {
		if unicode.IsControl(char) {
			return "", validationError("command cannot contain control characters")
		}
	}
	return command, nil
}

func serverCommandAuditMetadata(output string, err error) map[string]any {
	return map[string]any{
		"success":      err == nil,
		"error":        errorString(err),
		"output_bytes": len(output),
	}
}
