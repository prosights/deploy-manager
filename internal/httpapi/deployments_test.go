package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"deploy-manager/internal/auditlog"
	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestNormalizeCreateDeploymentTrimsDefaultsAndNullsBlankText(t *testing.T) {
	input, err := normalizeCreateDeployment(db.CreateDeploymentParams{
		ApplicationID: pgtype.UUID{Valid: true},
		Trigger:       " ",
		Strategy:      " ",
		Actor:         pgtype.Text{String: " ", Valid: true},
		CommitSha:     pgtype.Text{String: " abc1234 ", Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}

	if input.Trigger != "manual" || input.Strategy != "rolling" {
		t.Fatalf("unexpected deployment defaults: %+v", input)
	}
	if !input.CommitSha.Valid || input.CommitSha.String != "abc1234" {
		t.Fatalf("expected trimmed commit sha, got %+v", input.CommitSha)
	}
	if input.Actor.Valid {
		t.Fatalf("expected blank actor to be null, got %+v", input.Actor)
	}
}

func TestNormalizeCreateDeploymentRejectsMissingApplication(t *testing.T) {
	_, err := normalizeCreateDeployment(db.CreateDeploymentParams{Strategy: "rolling"})
	if err == nil {
		t.Fatal("expected missing application to fail")
	}
}

func TestNormalizeCreateDeploymentRejectsUnsupportedStrategy(t *testing.T) {
	_, err := normalizeCreateDeployment(db.CreateDeploymentParams{
		ApplicationID: pgtype.UUID{Valid: true},
		Strategy:      "canary",
	})
	if err == nil {
		t.Fatal("expected unsupported strategy to fail")
	}
}

func TestNormalizeCreateDeploymentRejectsUnsupportedTrigger(t *testing.T) {
	_, err := normalizeCreateDeployment(db.CreateDeploymentParams{
		ApplicationID: pgtype.UUID{Valid: true},
		Trigger:       "shell",
	})
	if err == nil {
		t.Fatal("expected unsupported trigger to fail")
	}
}

func TestNormalizeCreateDeploymentRejectsInvalidCommit(t *testing.T) {
	_, err := normalizeCreateDeployment(db.CreateDeploymentParams{
		ApplicationID: pgtype.UUID{Valid: true},
		CommitSha:     pgtype.Text{String: "not-a-sha", Valid: true},
	})
	if err == nil {
		t.Fatal("expected invalid commit sha to fail")
	}
}

func TestNormalizeCreateDeploymentRejectsActorControlCharacters(t *testing.T) {
	_, err := normalizeCreateDeployment(db.CreateDeploymentParams{
		ApplicationID: pgtype.UUID{Valid: true},
		Actor:         pgtype.Text{String: "ali\nroot", Valid: true},
	})
	if err == nil {
		t.Fatal("expected actor with control characters to fail")
	}
}

func TestDeploymentHistoryLimitDefaultsAndClamps(t *testing.T) {
	tests := []struct {
		value string
		want  int32
	}{
		{value: "", want: defaultDeploymentHistoryLimit},
		{value: " 25 ", want: 25},
		{value: "9999", want: maxDeploymentHistoryLimit},
	}

	for _, test := range tests {
		t.Run(test.value, func(t *testing.T) {
			got, err := deploymentHistoryLimit(test.value)
			if err != nil {
				t.Fatal(err)
			}
			if got != test.want {
				t.Fatalf("expected limit %d, got %d", test.want, got)
			}
		})
	}
}

func TestDeploymentHistoryLimitRejectsInvalidValues(t *testing.T) {
	for _, value := range []string{"0", "-1", "all"} {
		t.Run(value, func(t *testing.T) {
			if _, err := deploymentHistoryLimit(value); err == nil {
				t.Fatal("expected invalid history limit to fail")
			}
		})
	}
}

func TestDeploymentQueueMetadataIncludesPinnedCommit(t *testing.T) {
	metadata := deploymentQueueMetadata(db.Deployment{
		Trigger:   "manual",
		Strategy:  "blue_green",
		CommitSha: pgtype.Text{String: "abc1234", Valid: true},
		Actor:     pgtype.Text{String: "ali", Valid: true},
	})

	data := auditlog.Metadata(metadata)
	var decoded map[string]any
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["commit_sha"] != "abc1234" || decoded["actor"] != "ali" || decoded["strategy"] != "blue_green" {
		t.Fatalf("unexpected deployment queue metadata: %+v", decoded)
	}
}

func TestDeploymentQueueFailureMetadataIncludesFailureEvidence(t *testing.T) {
	metadata := deploymentQueueFailureMetadata(db.Deployment{
		Trigger:   "manual",
		Strategy:  "rolling",
		CommitSha: pgtype.Text{String: "abc1234", Valid: true},
	}, errors.New("enqueue deployment: redis down"))

	if metadata["status"] != "failed" || metadata["error"] != "enqueue deployment: redis down" {
		t.Fatalf("unexpected failure metadata: %+v", metadata)
	}
	if metadata["commit_sha"] != "abc1234" || metadata["strategy"] != "rolling" {
		t.Fatalf("expected queue metadata to be preserved, got %+v", metadata)
	}
}

func TestRetryDeploymentInputCopiesRetryableDeploymentTarget(t *testing.T) {
	applicationID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}

	input, err := retryDeploymentInput(db.Deployment{
		ApplicationID: applicationID,
		Status:        "failed",
		Strategy:      "blue_green",
		CommitSha:     pgtype.Text{String: "abc1234", Valid: true},
	}, "ali")
	if err != nil {
		t.Fatal(err)
	}

	if input.ApplicationID != applicationID || input.Trigger != "retry" || input.Strategy != "blue_green" {
		t.Fatalf("unexpected retry input: %+v", input)
	}
	if !input.CommitSha.Valid || input.CommitSha.String != "abc1234" {
		t.Fatalf("expected source commit sha, got %+v", input.CommitSha)
	}
	if !input.Actor.Valid || input.Actor.String != "ali" {
		t.Fatalf("expected retry actor, got %+v", input.Actor)
	}
}

func TestRetryDeploymentInputRejectsActiveDeployment(t *testing.T) {
	_, err := retryDeploymentInput(db.Deployment{
		ApplicationID: pgtype.UUID{Valid: true},
		Status:        "running",
		Strategy:      "rolling",
	}, "ali")
	if err == nil {
		t.Fatal("expected active deployment retry to fail")
	}
}

func TestValidateBlueGreenDeploymentTargetRequiresColorAwareHealthCheck(t *testing.T) {
	tests := []struct {
		name        string
		healthCheck pgtype.Text
	}{
		{name: "missing"},
		{name: "without color", healthCheck: pgtype.Text{String: "https://api.example.com/healthz", Valid: true}},
		{name: "invalid url", healthCheck: pgtype.Text{String: "mailto:api-{color}@example.com", Valid: true}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateBlueGreenDeploymentTarget(db.Application{HealthCheckUrl: test.healthCheck})
			if err == nil {
				t.Fatal("expected invalid blue-green target to fail")
			}
		})
	}
}

func TestValidateBlueGreenDeploymentTargetAcceptsColorAwareHealthCheck(t *testing.T) {
	err := validateBlueGreenDeploymentTarget(db.Application{
		HealthCheckUrl: pgtype.Text{String: "https://api-{color}.example.com/healthz", Valid: true},
	})
	if err != nil {
		t.Fatalf("expected color-aware health check to pass, got %v", err)
	}
}

func TestDeploymentRetryMetadataLinksSourceDeployment(t *testing.T) {
	sourceID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	metadata := deploymentRetryMetadata(
		db.Deployment{ID: sourceID, Status: "failed"},
		db.Deployment{Trigger: "retry", Strategy: "rolling"},
	)

	if metadata["source_deployment_id"] != uuidString(sourceID) || metadata["source_status"] != "failed" {
		t.Fatalf("expected source retry metadata, got %+v", metadata)
	}
	if metadata["trigger"] != "retry" || metadata["strategy"] != "rolling" {
		t.Fatalf("expected queued deployment metadata, got %+v", metadata)
	}
}

func TestDeploymentCancelMetadataIncludesActor(t *testing.T) {
	metadata := deploymentCancelMetadata(db.Deployment{Status: "cancelled"}, " ali ")

	if metadata["status"] != "cancelled" || metadata["actor"] != "ali" {
		t.Fatalf("expected cancel audit metadata with actor, got %+v", metadata)
	}
}

func TestCreateDeploymentErrorMapsMissingApplicationToNotFound(t *testing.T) {
	err := createDeploymentError(pgx.ErrNoRows)

	var notFound notFoundError
	if !errors.As(err, &notFound) {
		t.Fatalf("expected not found error, got %T", err)
	}
}

func TestCreateDeploymentErrorKeepsUnexpectedErrors(t *testing.T) {
	cause := errors.New("database down")

	if err := createDeploymentError(cause); !errors.Is(err, cause) {
		t.Fatalf("expected original error, got %v", err)
	}
}

func TestMarkDeploymentEnqueueFailedMarksDeploymentFailed(t *testing.T) {
	updater := &fakeDeploymentStatusUpdater{}
	deployment := db.Deployment{ID: pgtype.UUID{Bytes: [16]byte{1}, Valid: true}}

	err := markDeploymentEnqueueFailed(context.Background(), updater, deployment, errors.New("redis down"))
	if err == nil {
		t.Fatal("expected enqueue failure to be returned")
	}
	if updater.status != "failed" {
		t.Fatalf("expected deployment to be marked failed, got %q", updater.status)
	}
	if !strings.Contains(err.Error(), "redis down") {
		t.Fatalf("expected enqueue cause in error, got %q", err.Error())
	}
}

func TestEnqueueDeploymentDoesNotMarkFailedOnSuccess(t *testing.T) {
	queue := fakeDeploymentQueue{}
	updater := &fakeDeploymentStatusUpdater{}
	deployment := db.Deployment{ID: pgtype.UUID{Bytes: [16]byte{1}, Valid: true}}

	if err := enqueueDeployment(context.Background(), queue, updater, deployment); err != nil {
		t.Fatal(err)
	}
	if updater.status != "" {
		t.Fatalf("did not expect status update, got %q", updater.status)
	}
}

func TestEnqueueDeploymentMarksFailedOnQueueError(t *testing.T) {
	queue := fakeDeploymentQueue{err: errors.New("redis down")}
	updater := &fakeDeploymentStatusUpdater{}
	deployment := db.Deployment{ID: pgtype.UUID{Bytes: [16]byte{1}, Valid: true}}

	err := enqueueDeployment(context.Background(), queue, updater, deployment)
	if err == nil {
		t.Fatal("expected enqueue error")
	}
	if updater.status != "failed" {
		t.Fatalf("expected deployment to be marked failed, got %q", updater.status)
	}
}

func TestMarkDeploymentEnqueueFailedIncludesStatusUpdateFailure(t *testing.T) {
	updater := &fakeDeploymentStatusUpdater{err: errors.New("database down")}
	deployment := db.Deployment{ID: pgtype.UUID{Bytes: [16]byte{1}, Valid: true}}

	err := markDeploymentEnqueueFailed(context.Background(), updater, deployment, errors.New("redis down"))
	if err == nil {
		t.Fatal("expected enqueue failure to be returned")
	}
	if !strings.Contains(err.Error(), "database down") {
		t.Fatalf("expected status update cause in error, got %q", err.Error())
	}
}

type fakeDeploymentStatusUpdater struct {
	status string
	err    error
}

func (f *fakeDeploymentStatusUpdater) UpdateDeploymentStatus(_ context.Context, params db.UpdateDeploymentStatusParams) (db.Deployment, error) {
	f.status = params.Status
	if f.err != nil {
		return db.Deployment{}, f.err
	}
	return db.Deployment{ID: params.ID, Status: params.Status}, nil
}

type fakeDeploymentQueue struct {
	err error
}

func (f fakeDeploymentQueue) Enqueue(context.Context, db.Deployment) error {
	return f.err
}
