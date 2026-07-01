package httpapi

import (
	"context"
	"errors"
	"math"
	"math/big"
	"net/http"
	"strings"
	"time"

	"deploy-manager/internal/db"
	"deploy-manager/internal/dockerx"
	"deploy-manager/internal/sshutil"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type sshHealthChecker interface {
	Check(context.Context, db.Server) (sshutil.HealthResult, error)
}

type dockerEngineChecker interface {
	Check(context.Context, db.Server) (dockerx.EngineStatus, error)
}

type sshHealthCheck struct {
	signer sshutil.SignerSource
}

type dockerEngineCheck struct{}

var errDockerCheckSkipped = errors.New("docker check skipped because ssh failed")

// serverCheckTimeout bounds how long a synchronous connectivity check may tie
// up a request goroutine and SSH connection, independent of how long the client
// is willing to wait.
const serverCheckTimeout = 30 * time.Second

func (s Server) checkServer(w http.ResponseWriter, r *http.Request) {
	serverID, err := parseUUIDParam(r, "serverID")
	if err != nil {
		writeError(w, err)
		return
	}

	server, err := s.queries.GetServer(r.Context(), serverID)
	if err != nil {
		writeError(w, serverLookupError(err))
		return
	}
	if !server.SshKeyPath.Valid || strings.TrimSpace(server.SshKeyPath.String) == "" {
		writeError(w, validationError("server ssh_key_path is required for connectivity checks"))
		return
	}

	checkCtx, cancel := context.WithTimeout(r.Context(), serverCheckTimeout)
	defer cancel()
	check := s.runServerChecks(checkCtx, server)

	updated, updateErr := s.queries.UpdateServerHealth(r.Context(), db.UpdateServerHealthParams{
		ID:          server.ID,
		Status:      check.status,
		CpuUsage:    percentNumeric(check.health.CPUUsage, check.metricsValid),
		MemoryUsage: percentNumeric(check.health.MemoryUsage, check.metricsValid),
		DiskUsage:   percentNumeric(check.health.DiskUsage, check.metricsValid),
	})
	if updateErr != nil {
		writeError(w, updateErr)
		return
	}
	s.audit(r, "server.check", "server", uuidString(updated.ID), updated.Name, serverCheckAuditMetadata(updated.Status, check.sshErr, check.dockerErr))
	if check.sshErr != nil {
		writeJSON(w, http.StatusOK, newServerCheckResponse(updated, check.docker, check.sshErr, check.dockerErr))
		return
	}
	writeJSON(w, http.StatusOK, newServerCheckResponse(updated, check.docker, nil, check.dockerErr))
}

type serverCheckResult struct {
	health       sshutil.HealthResult
	status       string
	metricsValid bool
	docker       dockerx.EngineStatus
	sshErr       error
	dockerErr    error
}

func (s Server) runServerChecks(ctx context.Context, server db.Server) serverCheckResult {
	result, sshErr := s.sshHealthChecker().Check(ctx, server)
	status := result.Status
	if sshErr != nil && status == "" {
		status = "unreachable"
	}

	var dockerStatus dockerx.EngineStatus
	var dockerErr error
	if sshErr == nil {
		dockerStatus, dockerErr = s.dockerEngineChecker().Check(ctx, server)
	} else {
		dockerErr = errDockerCheckSkipped
	}
	if dockerErr != nil && sshErr == nil {
		status = "degraded"
	}
	status = normalizeServerCheckStatus(status)

	return serverCheckResult{
		health:       result,
		status:       status,
		metricsValid: sshErr == nil,
		docker:       dockerStatus,
		sshErr:       sshErr,
		dockerErr:    dockerErr,
	}
}

func normalizeServerCheckStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "healthy", "degraded", "unreachable":
		return strings.TrimSpace(status)
	default:
		return "unknown"
	}
}

func (s Server) sshHealthChecker() sshHealthChecker {
	if s.sshHealth != nil {
		return s.sshHealth
	}
	return sshHealthCheck{}
}

func (s Server) dockerEngineChecker() dockerEngineChecker {
	if s.dockerEngine != nil {
		return s.dockerEngine
	}
	return dockerEngineCheck{}
}

func (c sshHealthCheck) Check(ctx context.Context, server db.Server) (sshutil.HealthResult, error) {
	signerSource := c.signer
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
		return sshutil.HealthResult{}, err
	}
	return sshutil.Check(ctx, server.Hostname, server.SshPort, server.SshUser, signer)
}

func (dockerEngineCheck) Check(ctx context.Context, server db.Server) (dockerx.EngineStatus, error) {
	dockerHost, err := dockerx.BuildSSHHost(server.SshUser, server.Hostname, server.SshPort)
	if err != nil {
		return dockerx.EngineStatus{}, err
	}
	return dockerx.Check(ctx, dockerHost)
}

type serverCheckResponse struct {
	Server      db.Server             `json:"server"`
	SSHOK       bool                  `json:"ssh_ok"`
	DockerOK    bool                  `json:"docker_ok"`
	Docker      *dockerx.EngineStatus `json:"docker,omitempty"`
	Error       string                `json:"error,omitempty"`
	DockerError string                `json:"docker_error,omitempty"`
}

func newServerCheckResponse(server db.Server, docker dockerx.EngineStatus, sshErr error, dockerErr error) serverCheckResponse {
	response := serverCheckResponse{
		Server:      server,
		SSHOK:       sshErr == nil,
		DockerOK:    dockerErr == nil,
		Error:       errorString(sshErr),
		DockerError: errorString(dockerErr),
	}
	if dockerErr == nil {
		response.Docker = &docker
	}
	return response
}

func serverCheckAuditMetadata(status string, sshErr error, dockerErr error) map[string]any {
	return map[string]any{
		"status":       status,
		"ssh_ok":       sshErr == nil,
		"docker_ok":    dockerErr == nil,
		"ssh_error":    errorString(sshErr),
		"docker_error": errorString(dockerErr),
	}
}

func serverLookupError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return notFoundError("server not found")
	}
	return err
}

func percentNumeric(value float64, valid bool) pgtype.Numeric {
	if !valid || math.IsNaN(value) || math.IsInf(value, 0) {
		return pgtype.Numeric{}
	}
	if value < 0 {
		value = 0
	}
	if value > 100 {
		value = 100
	}
	return pgtype.Numeric{
		Int:   big.NewInt(int64(math.Round(value * 100))),
		Exp:   -2,
		Valid: true,
	}
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
