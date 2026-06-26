package httpapi

import (
	"context"
	"errors"
	"math"
	"testing"

	"deploy-manager/internal/db"
	"deploy-manager/internal/dockerx"
	"deploy-manager/internal/sshutil"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestNewServerCheckResponseSeparatesSSHAndDockerStatus(t *testing.T) {
	response := newServerCheckResponse(
		db.Server{Name: "prod"},
		dockerx.EngineStatus{APIVersion: "1.45"},
		nil,
		errors.New("docker unavailable"),
	)

	if !response.SSHOK {
		t.Fatal("expected SSH check to be ok")
	}
	if response.DockerOK {
		t.Fatal("expected Docker check to fail")
	}
	if response.Error != "" || response.DockerError != "docker unavailable" {
		t.Fatalf("unexpected errors: %+v", response)
	}
	if response.Docker != nil {
		t.Fatalf("expected docker status to be omitted on error, got %+v", response.Docker)
	}
}

func TestNewServerCheckResponseIncludesDockerStatusOnSuccess(t *testing.T) {
	response := newServerCheckResponse(
		db.Server{Name: "prod"},
		dockerx.EngineStatus{APIVersion: "1.45"},
		nil,
		nil,
	)

	if !response.SSHOK || !response.DockerOK {
		t.Fatalf("expected checks to be ok, got %+v", response)
	}
	if response.Docker == nil || response.Docker.APIVersion != "1.45" {
		t.Fatalf("expected docker status to be preserved, got %+v", response.Docker)
	}
}

func TestServerCheckAuditMetadataIncludesFailureEvidence(t *testing.T) {
	metadata := serverCheckAuditMetadata("unreachable", errors.New("ssh timeout"), errors.New("docker unavailable"))

	if metadata["status"] != "unreachable" || metadata["ssh_ok"] != false || metadata["docker_ok"] != false {
		t.Fatalf("unexpected status metadata: %+v", metadata)
	}
	if metadata["ssh_error"] != "ssh timeout" || metadata["docker_error"] != "docker unavailable" {
		t.Fatalf("expected failure messages in metadata, got %+v", metadata)
	}
}

func TestServerCheckAuditMetadataMarksSuccessfulChecks(t *testing.T) {
	metadata := serverCheckAuditMetadata("healthy", nil, nil)

	if metadata["status"] != "healthy" || metadata["ssh_ok"] != true || metadata["docker_ok"] != true {
		t.Fatalf("unexpected success metadata: %+v", metadata)
	}
	if metadata["ssh_error"] != "" || metadata["docker_error"] != "" {
		t.Fatalf("did not expect error messages, got %+v", metadata)
	}
}

func TestPercentNumericRejectsInvalidMetrics(t *testing.T) {
	for _, value := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		t.Run("non-finite", func(t *testing.T) {
			if got := percentNumeric(value, true); got.Valid {
				t.Fatalf("expected non-finite metric to be invalid, got %+v", got)
			}
		})
	}
	if got := percentNumeric(50, false); got.Valid {
		t.Fatalf("expected explicitly invalid metric to be invalid, got %+v", got)
	}
}

func TestPercentNumericStoresTwoDecimalPlaces(t *testing.T) {
	got := percentNumeric(12.345, true)
	if !got.Valid || got.Exp != -2 || got.Int.Int64() != 1235 {
		t.Fatalf("expected rounded percentage with two decimals, got %+v", got)
	}
}

func TestPercentNumericClampsOutOfRangeMetrics(t *testing.T) {
	low := percentNumeric(-1, true)
	if !low.Valid || low.Int.Int64() != 0 {
		t.Fatalf("expected negative metric to clamp to zero, got %+v", low)
	}
	high := percentNumeric(101.25, true)
	if !high.Valid || high.Int.Int64() != 10000 {
		t.Fatalf("expected high metric to clamp to one hundred, got %+v", high)
	}
}

func TestRunServerChecksMarksDockerFailureAsDegraded(t *testing.T) {
	server := Server{
		sshHealth: fakeSSHHealthChecker{
			result: sshutil.HealthResult{Status: "healthy", CPUUsage: 10, MemoryUsage: 20, DiskUsage: 30},
		},
		dockerEngine: fakeDockerEngineChecker{err: errors.New("docker unavailable")},
	}

	result := server.runServerChecks(context.Background(), db.Server{SshKeyPath: pgtype.Text{String: "~/.ssh/id_ed25519", Valid: true}})

	if result.status != "degraded" || !result.metricsValid {
		t.Fatalf("expected degraded server with valid SSH metrics, got %+v", result)
	}
	if result.sshErr != nil || result.dockerErr == nil {
		t.Fatalf("expected only Docker to fail, got ssh=%v docker=%v", result.sshErr, result.dockerErr)
	}
}

func TestRunServerChecksMarksSSHFailureAsUnreachable(t *testing.T) {
	docker := &countingDockerEngineChecker{err: errors.New("docker unavailable")}
	server := Server{
		sshHealth:    fakeSSHHealthChecker{err: errors.New("ssh timeout")},
		dockerEngine: docker,
	}

	result := server.runServerChecks(context.Background(), db.Server{SshKeyPath: pgtype.Text{String: "~/.ssh/id_ed25519", Valid: true}})

	if result.status != "unreachable" || result.metricsValid {
		t.Fatalf("expected unreachable server without valid metrics, got %+v", result)
	}
	if result.sshErr == nil || !errors.Is(result.dockerErr, errDockerCheckSkipped) {
		t.Fatalf("expected SSH failure and skipped Docker check, got ssh=%v docker=%v", result.sshErr, result.dockerErr)
	}
	if docker.calls != 0 {
		t.Fatalf("did not expect Docker check after SSH failure, got %d calls", docker.calls)
	}
}

func TestRunServerChecksNormalizesBlankSuccessStatus(t *testing.T) {
	server := Server{
		sshHealth: fakeSSHHealthChecker{
			result: sshutil.HealthResult{CPUUsage: 10, MemoryUsage: 20, DiskUsage: 30},
		},
		dockerEngine: fakeDockerEngineChecker{},
	}

	result := server.runServerChecks(context.Background(), db.Server{SshKeyPath: pgtype.Text{String: "~/.ssh/id_ed25519", Valid: true}})

	if result.status != "unknown" || !result.metricsValid {
		t.Fatalf("expected unknown server with valid metrics, got %+v", result)
	}
}

func TestNormalizeServerCheckStatusRejectsUnexpectedValues(t *testing.T) {
	for _, status := range []string{"", "idle", "failed", " healthy "} {
		t.Run(status, func(t *testing.T) {
			got := normalizeServerCheckStatus(status)
			if status == " healthy " {
				if got != "healthy" {
					t.Fatalf("expected trimmed healthy status, got %q", got)
				}
				return
			}
			if got != "unknown" {
				t.Fatalf("expected unknown status, got %q", got)
			}
		})
	}
}

func TestServerLookupErrorMapsMissingServerToNotFound(t *testing.T) {
	err := serverLookupError(pgx.ErrNoRows)
	if _, ok := err.(notFoundError); !ok {
		t.Fatalf("expected not found error, got %T", err)
	}
	if err.Error() != "server not found" {
		t.Fatalf("expected server not found message, got %q", err.Error())
	}
}

func TestServerLookupErrorPreservesUnexpectedErrors(t *testing.T) {
	cause := errors.New("database unavailable")
	if err := serverLookupError(cause); !errors.Is(err, cause) {
		t.Fatalf("expected original error, got %v", err)
	}
}

type fakeSSHHealthChecker struct {
	result sshutil.HealthResult
	err    error
}

func (checker fakeSSHHealthChecker) Check(context.Context, db.Server) (sshutil.HealthResult, error) {
	return checker.result, checker.err
}

type fakeDockerEngineChecker struct {
	result dockerx.EngineStatus
	err    error
}

func (checker fakeDockerEngineChecker) Check(context.Context, db.Server) (dockerx.EngineStatus, error) {
	return checker.result, checker.err
}

type countingDockerEngineChecker struct {
	result dockerx.EngineStatus
	err    error
	calls  int
}

func (checker *countingDockerEngineChecker) Check(context.Context, db.Server) (dockerx.EngineStatus, error) {
	checker.calls++
	return checker.result, checker.err
}
