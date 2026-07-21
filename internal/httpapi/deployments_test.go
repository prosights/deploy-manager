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
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestNormalizeCreateDeploymentTrimsDefaultsAndNullsBlankText(t *testing.T) {
	input, err := normalizeCreateDeployment(db.CreateDeploymentParams{
		ApplicationID: pgtype.UUID{Valid: true},
		Trigger:       " ",
		Strategy:      " ",
		Actor:         pgtype.Text{String: " ", Valid: true},
		CommitSha:     pgtype.Text{String: " abc1234 ", Valid: true},
		ImageRef:      pgtype.Text{String: "ghcr.io/acme/app:1.0.0", Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}

	if input.Trigger != "manual" || input.Strategy != "blue_green" {
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
	for _, strategy := range []string{"canary", "rolling"} {
		_, err := normalizeCreateDeployment(db.CreateDeploymentParams{
			ApplicationID: pgtype.UUID{Valid: true},
			Strategy:      strategy,
		})
		if err == nil {
			t.Fatalf("expected strategy %q to be rejected", strategy)
		}
	}
}

func TestNormalizeCreateDeploymentAllowsMissingImageRefForSourceDeploys(t *testing.T) {
	input, err := normalizeCreateDeployment(db.CreateDeploymentParams{
		ApplicationID: pgtype.UUID{Valid: true},
	})
	if err != nil {
		t.Fatalf("expected missing image_ref to be allowed (source deploy), got %v", err)
	}
	if input.ImageRef.Valid {
		t.Fatalf("expected image_ref to remain null, got %+v", input.ImageRef)
	}
}

func TestValidateDeploymentSourceAcceptsImageRef(t *testing.T) {
	err := validateDeploymentSource(db.Application{}, pgtype.Text{String: "ghcr.io/acme/app:1.0.0", Valid: true})
	if err != nil {
		t.Fatalf("expected image_ref deploy to be valid, got %v", err)
	}
}

func TestValidateDeploymentSourceAcceptsRepositoryWithCompose(t *testing.T) {
	err := validateDeploymentSource(db.Application{
		RepositoryUrl: pgtype.Text{String: "https://github.com/acme/app.git", Valid: true},
		ComposePath:   "docker-compose.yml",
	}, pgtype.Text{})
	if err != nil {
		t.Fatalf("expected repo+compose source deploy to be valid, got %v", err)
	}
}

func TestValidateDeploymentSourceRejectsNoImageAndNoRepo(t *testing.T) {
	err := validateDeploymentSource(db.Application{ComposePath: "docker-compose.yml"}, pgtype.Text{})
	if err == nil {
		t.Fatal("expected deploy with neither image_ref nor repository_url to be rejected")
	}
}

func TestValidateDeploymentSourceRejectsRepoWithoutCompose(t *testing.T) {
	err := validateDeploymentSource(db.Application{
		RepositoryUrl: pgtype.Text{String: "https://github.com/acme/app.git", Valid: true},
	}, pgtype.Text{})
	if err == nil {
		t.Fatal("expected repo without compose_path to be rejected")
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
		ImageRef:      pgtype.Text{String: "ghcr.io/acme/app:1.0.0", Valid: true},
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

func TestConfigurationRedeployInputPinsActiveDeploymentSource(t *testing.T) {
	applicationID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	sourceDeploymentID := pgtype.UUID{Bytes: [16]byte{3}, Valid: true}
	input, err := configurationRedeployInput(configurationRedeploySource{
		ApplicationID:      applicationID,
		SourceDeploymentID: sourceDeploymentID,
		CommitSHA:          pgtype.Text{String: "abcdef1234567890abcdef1234567890abcdef12", Valid: true},
		ImageRef:           pgtype.Text{String: "ghcr.io/acme/app:sha-abcdef1", Valid: true},
		ImageDigest:        pgtype.Text{String: "sha256:" + strings.Repeat("a", 64), Valid: true},
	}, " ali ")
	if err != nil {
		t.Fatal(err)
	}
	if input.ApplicationID != applicationID || input.Trigger != "manual" || input.Strategy != "blue_green" {
		t.Fatalf("unexpected configuration redeploy input: %+v", input)
	}
	expectedImage := "ghcr.io/acme/app:sha-abcdef1@sha256:" + strings.Repeat("a", 64)
	if input.CommitSha.String != "abcdef1234567890abcdef1234567890abcdef12" || input.ImageRef.String != expectedImage {
		t.Fatalf("expected active deployment source to be pinned, got %+v", input)
	}
	if input.ImageDigest.String != "sha256:"+strings.Repeat("a", 64) {
		t.Fatalf("expected active deployment digest to be preserved, got %+v", input.ImageDigest)
	}
	if input.Actor.String != "ali" {
		t.Fatalf("expected normalized actor, got %+v", input.Actor)
	}
}

func TestConfigurationRedeployInputPreservesImageWithoutDigest(t *testing.T) {
	input, err := configurationRedeployInput(configurationRedeploySource{
		ApplicationID:      pgtype.UUID{Valid: true},
		SourceDeploymentID: pgtype.UUID{Valid: true},
		ImageRef:           pgtype.Text{String: "ghcr.io/acme/app:sha-abcdef1", Valid: true},
	}, "ali")
	if err != nil {
		t.Fatal(err)
	}
	if input.ImageRef.String != "ghcr.io/acme/app:sha-abcdef1" || input.ImageDigest.Valid {
		t.Fatalf("expected existing commit-SHA tag without a digest to remain deployable, got %+v", input)
	}
}

func TestConfigurationRedeployInputUsesConfiguredSourceAfterRepositoryChange(t *testing.T) {
	input, err := configurationRedeployInput(configurationRedeploySource{
		ApplicationID:           pgtype.UUID{Valid: true},
		SourceDeploymentID:      pgtype.UUID{Valid: true},
		CommitSHA:               pgtype.Text{String: "abcdef1234567890abcdef1234567890abcdef12", Valid: true},
		ImageRef:                pgtype.Text{String: "ghcr.io/acme/app:sha-abcdef1", Valid: true},
		ImageDigest:             pgtype.Text{String: "sha256:" + strings.Repeat("a", 64), Valid: true},
		SourceRepositoryURL:     pgtype.Text{String: "https://github.com/acme/old.git", Valid: true},
		SourceBranch:            pgtype.Text{String: "main", Valid: true},
		ConfiguredRepositoryURL: pgtype.Text{String: "https://github.com/acme/new.git", Valid: true},
		ConfiguredBranch:        "release",
	}, "ali")
	if err != nil {
		t.Fatal(err)
	}
	if input.CommitSha.Valid || input.ImageRef.Valid || input.ImageDigest.Valid {
		t.Fatalf("expected a changed repository to resolve its configured branch head, got %+v", input)
	}
}

func TestConfigurationRedeployInputRejectsConflictingImageDigest(t *testing.T) {
	_, err := configurationRedeployInput(configurationRedeploySource{
		ApplicationID:      pgtype.UUID{Valid: true},
		SourceDeploymentID: pgtype.UUID{Valid: true},
		ImageRef:           pgtype.Text{String: "ghcr.io/acme/app@sha256:" + strings.Repeat("a", 64), Valid: true},
		ImageDigest:        pgtype.Text{String: "sha256:" + strings.Repeat("b", 64), Valid: true},
	}, "ali")
	if err == nil {
		t.Fatal("expected conflicting image digests to be rejected")
	}
}

func TestConfigurationRedeployInputRejectsMissingActiveSource(t *testing.T) {
	tests := []configurationRedeploySource{
		{ApplicationID: pgtype.UUID{Valid: true}},
		{
			ApplicationID:      pgtype.UUID{Valid: true},
			SourceDeploymentID: pgtype.UUID{Valid: true},
			CommitSHA:          pgtype.Text{String: " ", Valid: true},
			ImageRef:           pgtype.Text{String: " ", Valid: true},
		},
	}
	for _, source := range tests {
		if _, err := configurationRedeployInput(source, "ali"); err == nil {
			t.Fatal("expected configuration redeploy without an active pinned source to fail")
		}
	}
}

func TestConfigurationRedeployMetadataLinksActiveDeployment(t *testing.T) {
	sourceDeploymentID := pgtype.UUID{Bytes: [16]byte{3}, Valid: true}
	metadata := configurationRedeployMetadata(
		configurationRedeploySource{SourceDeploymentID: sourceDeploymentID},
		db.Deployment{Trigger: "manual", Strategy: "blue_green"},
	)
	if metadata["source_deployment_id"] != uuidString(sourceDeploymentID) || metadata["reason"] != "configuration_changed" {
		t.Fatalf("expected configuration redeploy source metadata, got %+v", metadata)
	}
}

func TestConfigurationRedeployResponseDescribesInProgressAndPartialResults(t *testing.T) {
	inProgress := newConfigurationRedeployResponse(nil, []configurationRedeployResult{{
		Status: configurationRedeploySkipped,
		Reason: configurationRedeployInProgress,
	}})
	if inProgress.State != "in_progress" || inProgress.Skipped != 1 {
		t.Fatalf("expected explicit in-progress response, got %+v", inProgress)
	}

	partial := newConfigurationRedeployResponse([]db.Deployment{{ID: pgtype.UUID{Valid: true}}}, []configurationRedeployResult{
		{Status: configurationRedeployQueued},
		{Status: configurationRedeployFailed, Reason: configurationRedeployCreationFailed},
	})
	if partial.State != "partial" || partial.Queued != 1 || partial.Failed != 1 {
		t.Fatalf("expected deterministic partial response counts, got %+v", partial)
	}
}

func TestValidateBlueGreenDeploymentTargetRequiresColorAndPortAwareHealthCheck(t *testing.T) {
	tests := []struct {
		name        string
		healthCheck pgtype.Text
	}{
		{name: "missing"},
		{name: "without color", healthCheck: pgtype.Text{String: "https://api.example.com/healthz", Valid: true}},
		{name: "without port", healthCheck: pgtype.Text{String: "https://api-{color}.example.com/healthz", Valid: true}},
		{name: "invalid url", healthCheck: pgtype.Text{String: "mailto:api-{color}:{port}@example.com", Valid: true}},
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

func TestValidateBlueGreenDeploymentTargetAcceptsColorAndPortAwareHealthCheck(t *testing.T) {
	err := validateBlueGreenDeploymentTarget(db.Application{
		HealthCheckUrl: pgtype.Text{String: "http://127.0.0.1:{port}/healthz?color={color}", Valid: true},
	})
	if err != nil {
		t.Fatalf("expected color-and-port-aware health check to pass, got %v", err)
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

func TestCreateDeploymentErrorMapsConcurrentDeploymentToValidation(t *testing.T) {
	err := createDeploymentError(&pgconn.PgError{
		Code:           "23505",
		ConstraintName: "deployments_one_in_progress_per_application",
	})

	var validation validationError
	if !errors.As(err, &validation) || validation.Error() != deploymentInProgressMessage || !isDeploymentInProgressError(err) {
		t.Fatalf("expected in-progress validation error, got %T: %v", err, err)
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
