package deployments

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"deploy-manager/internal/connectors"
	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestQueuePayloadRequiresDeploymentID(t *testing.T) {
	if _, err := decodePayload(`{}`); err == nil {
		t.Fatal("expected missing deployment_id to fail")
	}
}

func TestQueuePayloadRejectsUnknownFields(t *testing.T) {
	_, err := decodePayload(`{"deployment_id":"018f3a2b-8a55-7c5f-90c5-11bbf0eb42b2","attempt":1}`)
	if err == nil {
		t.Fatal("expected unknown queue payload field to fail")
	}
}

func TestQueuePayloadRejectsTrailingJSONValues(t *testing.T) {
	_, err := decodePayload(`{"deployment_id":"018f3a2b-8a55-7c5f-90c5-11bbf0eb42b2"} {"deployment_id":"018f3a2b-8a55-7c5f-90c5-11bbf0eb42b3"}`)
	if err == nil {
		t.Fatal("expected trailing queue payload value to fail")
	}
}

func TestQueuePayloadRoundTrip(t *testing.T) {
	payload, err := decodePayload(`{"deployment_id":" 018f3a2b-8a55-7c5f-90c5-11bbf0eb42b2 "}`)
	if err != nil {
		t.Fatal(err)
	}

	id, err := pgUUID(payload.DeploymentID)
	if err != nil {
		t.Fatal(err)
	}
	if uuidString(id) != payload.DeploymentID {
		t.Fatalf("expected %s, got %s", payload.DeploymentID, uuidString(id))
	}
}

func TestShouldRunDeploymentOnlyAllowsQueued(t *testing.T) {
	if !shouldRunDeployment("queued") {
		t.Fatal("expected queued deployment to run")
	}
	for _, status := range []string{"running", "succeeded", "failed", "cancelled"} {
		if shouldRunDeployment(status) {
			t.Fatalf("did not expect %s deployment to run", status)
		}
	}
}

func TestRecoverQueuedUsesDefaultLimitAndEnqueuesDeployments(t *testing.T) {
	deploymentID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	var gotLimit int32
	var enqueued []pgtype.UUID

	count, err := recoverQueued(context.Background(), 0, func(_ context.Context, limit int32) ([]db.Deployment, error) {
		gotLimit = limit
		return []db.Deployment{{ID: deploymentID, Status: "queued"}}, nil
	}, func(_ context.Context, deployment db.Deployment) error {
		enqueued = append(enqueued, deployment.ID)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 || gotLimit != defaultRecoveryLimit {
		t.Fatalf("expected one recovered deployment with default limit, got count=%d limit=%d", count, gotLimit)
	}
	if len(enqueued) != 1 || enqueued[0] != deploymentID {
		t.Fatalf("expected deployment to be enqueued, got %+v", enqueued)
	}
}

func TestRecoverQueuedReportsPartialEnqueueFailure(t *testing.T) {
	deployments := []db.Deployment{
		{ID: pgtype.UUID{Bytes: [16]byte{1}, Valid: true}, Status: "queued"},
		{ID: pgtype.UUID{Bytes: [16]byte{2}, Valid: true}, Status: "queued"},
	}
	attempts := 0

	count, err := recoverQueued(context.Background(), 10, func(context.Context, int32) ([]db.Deployment, error) {
		return deployments, nil
	}, func(context.Context, db.Deployment) error {
		attempts++
		if attempts == 2 {
			return errors.New("redis unavailable")
		}
		return nil
	})
	if err == nil {
		t.Fatal("expected enqueue failure")
	}
	if count != 1 || attempts != 2 {
		t.Fatalf("expected one successful recovery before failure, got count=%d attempts=%d", count, attempts)
	}
}

func TestRecoverInterruptedMarksRunningDeploymentsFailedAndLogsRestart(t *testing.T) {
	deploymentID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	var logs []db.AppendDeploymentLogParams

	count, err := recoverInterrupted(context.Background(), func(context.Context) ([]db.FailRunningDeploymentsForRecoveryRow, error) {
		return []db.FailRunningDeploymentsForRecoveryRow{{ID: deploymentID, Status: "failed"}}, nil
	}, func(_ context.Context, params db.AppendDeploymentLogParams) (db.DeploymentLog, error) {
		logs = append(logs, params)
		return db.DeploymentLog{}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected one recovered deployment, got %d", count)
	}
	if len(logs) != 1 || logs[0].DeploymentID != deploymentID || logs[0].Stream != "system" {
		t.Fatalf("expected interrupted deployment log, got %+v", logs)
	}
	if logs[0].Message != interruptedDeploymentLogMessage {
		t.Fatalf("expected restart log message, got %q", logs[0].Message)
	}
}

func TestRecoverInterruptedReturnsStatusRecoveryFailure(t *testing.T) {
	_, err := recoverInterrupted(context.Background(), func(context.Context) ([]db.FailRunningDeploymentsForRecoveryRow, error) {
		return nil, errors.New("database unavailable")
	}, func(context.Context, db.AppendDeploymentLogParams) (db.DeploymentLog, error) {
		t.Fatal("did not expect log append after status recovery failure")
		return db.DeploymentLog{}, nil
	})
	if err == nil {
		t.Fatal("expected recovery failure")
	}
}

func TestRecoverInterruptedReturnsLogFailure(t *testing.T) {
	deploymentID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}

	count, err := recoverInterrupted(context.Background(), func(context.Context) ([]db.FailRunningDeploymentsForRecoveryRow, error) {
		return []db.FailRunningDeploymentsForRecoveryRow{{ID: deploymentID, Status: "failed"}}, nil
	}, func(context.Context, db.AppendDeploymentLogParams) (db.DeploymentLog, error) {
		return db.DeploymentLog{}, errors.New("log unavailable")
	})
	if err == nil {
		t.Fatal("expected log failure")
	}
	if count != 1 {
		t.Fatalf("expected marked deployment count to be returned, got %d", count)
	}
}

func TestRemoteStepsUseRepositoryWhenConfigured(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "API Service",
		RepositoryUrl:   pgtype.Text{String: "git@github.com:acme/app.git", Valid: true},
		Branch:          "main",
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/app",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(commands(steps), "\n")
	if !strings.Contains(joined, "git clone") {
		t.Fatal("expected repository sync command")
	}
	if !strings.Contains(joined, "git -c safe.directory='/srv/app' reset --hard origin/'main'") {
		t.Fatal("expected repository sync to reset tracked local changes before deploy")
	}
	if strings.Contains(joined, "rm -rf '/srv/app'") {
		t.Fatal("repository sync must not remove the deployment root")
	}
	if !strings.Contains(joined, "find '/srv/app' -mindepth 1 -maxdepth 1 -exec rm -rf {} +") {
		t.Fatal("expected repository sync to clear deployment root contents")
	}
	if !strings.Contains(joined, "docker compose -f 'docker-compose.yml' config --quiet") {
		t.Fatal("expected compose config validation command")
	}
	if !strings.Contains(joined, "COMPOSE_PROJECT_NAME='api-service' docker compose -f 'docker-compose.yml' up -d --remove-orphans") {
		t.Fatal("expected compose up command")
	}
}

func TestRemoteStepsUseStableComposeProjectForRollingDeployments(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "Billing API",
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/billing-api",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(commands(steps), "\n")
	if !strings.Contains(joined, "COMPOSE_PROJECT_NAME='billing-api' docker compose -f 'docker-compose.yml' pull") {
		t.Fatalf("expected compose pull to use stable project name, got %s", joined)
	}
	if !strings.Contains(joined, "COMPOSE_PROJECT_NAME='billing-api' docker compose -f 'docker-compose.yml' up -d --remove-orphans") {
		t.Fatalf("expected compose up to use stable project name, got %s", joined)
	}
}

func TestRemoteStepsCheckoutDeploymentCommitWhenConfigured(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		RepositoryUrl:   pgtype.Text{String: "git@github.com:acme/app.git", Valid: true},
		Branch:          "main",
		CommitSha:       pgtype.Text{String: "abc1234", Valid: true},
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/app",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(commands(steps), "\n")
	if !strings.Contains(joined, "cd '/srv/app' && git -c safe.directory='/srv/app' checkout --detach 'abc1234'") {
		t.Fatalf("expected deployment commit checkout, got %s", joined)
	}
}

func TestRemoteStepsRejectInvalidDeploymentCommit(t *testing.T) {
	_, err := remoteSteps(db.GetDeploymentTargetRow{
		RepositoryUrl:   pgtype.Text{String: "git@github.com:acme/app.git", Valid: true},
		Branch:          "main",
		CommitSha:       pgtype.Text{String: "not-a-sha", Valid: true},
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/app",
	}, nil)
	if err == nil {
		t.Fatal("expected invalid deployment commit to fail")
	}
}

func TestRemoteStepsRejectUnsafeRepositoryBranch(t *testing.T) {
	for _, branch := range []string{"-main", "feature//api", "feature..api", "feature/api.lock", "feature api", "feature@{1}"} {
		t.Run(branch, func(t *testing.T) {
			_, err := remoteSteps(db.GetDeploymentTargetRow{
				RepositoryUrl:   pgtype.Text{String: "git@github.com:acme/app.git", Valid: true},
				Branch:          branch,
				ComposePath:     "docker-compose.yml",
				RemoteDirectory: "/srv/app",
			}, nil)
			if err == nil {
				t.Fatal("expected unsafe branch to fail")
			}
		})
	}
}

func TestValidateGitRefNameAllowsOperationalBranchNames(t *testing.T) {
	for _, branch := range []string{"main", "release/2026-06", "feature_api.v2"} {
		t.Run(branch, func(t *testing.T) {
			if err := ValidateGitRefName(branch); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRemoteStepsRejectUnsafeRemoteDirectory(t *testing.T) {
	for _, remoteDir := range []string{"", "app", "/", "/srv/../api", "/srv//api"} {
		_, err := remoteSteps(db.GetDeploymentTargetRow{
			ComposePath:     "docker-compose.yml",
			RemoteDirectory: remoteDir,
		}, nil)
		if err == nil {
			t.Fatalf("expected remote directory %q to fail", remoteDir)
		}
	}
}

func TestRemoteStepsRejectBlankComposePath(t *testing.T) {
	_, err := remoteSteps(db.GetDeploymentTargetRow{
		RemoteDirectory: "/srv/app",
	}, nil)
	if err == nil {
		t.Fatal("expected blank compose path to fail")
	}
}

func TestRemoteStepsRejectUnsafeComposePath(t *testing.T) {
	for _, composePath := range []string{"/srv/app/docker-compose.yml", "../docker-compose.yml", "deploy/../docker-compose.yml", "."} {
		_, err := remoteSteps(db.GetDeploymentTargetRow{
			ComposePath:     composePath,
			RemoteDirectory: "/srv/app",
		}, nil)
		if err == nil {
			t.Fatalf("expected compose path %q to fail", composePath)
		}
	}
}

func TestRemoteStepsSkipRepositoryWhenNotConfigured(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ComposePath:     "compose.yml",
		RemoteDirectory: "/srv/app",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(commands(steps), "\n")
	if strings.Contains(joined, "git clone") {
		t.Fatal("did not expect repository sync command")
	}
}

func TestRemoteStepsBuildOnTargetForSourceRollingDeploy(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "API Service",
		RepositoryUrl:   pgtype.Text{String: "git@github.com:acme/app.git", Valid: true},
		Branch:          "main",
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/app",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(commands(steps), "\n")
	if !strings.Contains(joined, "COMPOSE_PROJECT_NAME='api-service' docker compose -f 'docker-compose.yml' build --pull") {
		t.Fatalf("expected source deploy to build on target, got %s", joined)
	}
	if strings.Contains(joined, "docker compose -f 'docker-compose.yml' pull") {
		t.Fatalf("did not expect a registry pull for a source deploy, got %s", joined)
	}
}

func TestRemoteStepsPullForArtifactRollingDeploy(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "API Service",
		RepositoryUrl:   pgtype.Text{String: "git@github.com:acme/app.git", Valid: true},
		Branch:          "main",
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/app",
		ImageRef:        pgtype.Text{String: "ghcr.io/acme/app:1.0.0", Valid: true},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(commands(steps), "\n")
	if !strings.Contains(joined, "docker compose -f 'docker-compose.yml' pull") {
		t.Fatalf("expected artifact deploy to pull the pinned image, got %s", joined)
	}
	if strings.Contains(joined, "build --pull") {
		t.Fatalf("did not expect a build step for an artifact deploy, got %s", joined)
	}
}

func TestRemoteStepsBuildOnTargetForSourceBlueGreenDeploy(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "API Service",
		Strategy:        "blue_green",
		RepositoryUrl:   pgtype.Text{String: "git@github.com:acme/app.git", Valid: true},
		Branch:          "main",
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/api",
		HealthCheckUrl:  pgtype.Text{String: "https://api-{color}.example.com/healthz", Valid: true},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(commands(steps), "\n")
	if !strings.Contains(joined, "docker compose -f 'docker-compose.yml' build --pull") {
		t.Fatalf("expected blue-green source deploy to build the next color, got %s", joined)
	}
}

func TestRemoteStepsUseBlueGreenStrategy(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "API Service",
		Strategy:        "blue_green",
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/api",
		HealthCheckUrl:  pgtype.Text{String: "https://api-{color}.example.com/healthz", Valid: true},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(commands(steps), "\n")
	if !strings.Contains(joined, ".deploy-manager-next-color") {
		t.Fatal("expected blue-green color selection")
	}
	if !strings.Contains(joined, "COMPOSE_PROJECT_NAME='api-service'-$color DEPLOY_COLOR=$color") {
		t.Fatal("expected next color compose project")
	}
	if !strings.Contains(joined, "docker compose -f 'docker-compose.yml' config --quiet") {
		t.Fatal("expected compose config validation command")
	}
	if strings.Index(joined, "config --quiet") > strings.Index(joined, "docker compose -f 'docker-compose.yml' pull") {
		t.Fatal("expected compose config validation before image pull")
	}
	if strings.Contains(joined, "down --remove-orphans") {
		t.Fatal("did not expect previous color cleanup during warm blue-green deployment")
	}
}

func TestProjectSlugBoundsLongApplicationNames(t *testing.T) {
	got := projectSlug(strings.Repeat("billing-", 20))
	if len(got) > maxComposeProjectSlugLength {
		t.Fatalf("expected bounded project slug, got length %d: %q", len(got), got)
	}
	if !strings.Contains(got, "-") {
		t.Fatalf("expected hash suffix separator, got %q", got)
	}
	if got != projectSlug(strings.Repeat("billing-", 20)) {
		t.Fatalf("expected project slug to be stable, got %q", got)
	}
}

func TestProjectSlugDefaultsWhenApplicationNameHasNoSlug(t *testing.T) {
	if got := projectSlug(" !!! "); got != "deploy-manager-app" {
		t.Fatalf("expected default project slug, got %q", got)
	}
}

func TestRemoteStepsValidateComposeConfigBeforeRollingStart(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/api",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}

	labels := make([]string, 0, len(steps))
	for _, step := range steps {
		labels = append(labels, step.label)
	}
	joinedLabels := strings.Join(labels, "\n")
	if strings.Index(joinedLabels, "Validating compose config") > strings.Index(joinedLabels, "Pulling compose images") {
		t.Fatalf("expected compose validation before pull, got %+v", labels)
	}
}

func TestRemoteStepsRejectUnsupportedStrategy(t *testing.T) {
	_, err := remoteSteps(db.GetDeploymentTargetRow{
		Strategy:        "canary",
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/api",
	}, nil)
	if err == nil {
		t.Fatal("expected unsupported strategy to fail")
	}
}

func TestRemoteStepsRequireColorHealthCheckForBlueGreen(t *testing.T) {
	for _, healthCheckURL := range []pgtype.Text{
		{},
		{String: "https://api.example.com/healthz", Valid: true},
	} {
		_, err := remoteSteps(db.GetDeploymentTargetRow{
			ApplicationName: "API Service",
			Strategy:        "blue_green",
			ComposePath:     "docker-compose.yml",
			RemoteDirectory: "/srv/api",
			HealthCheckUrl:  healthCheckURL,
		}, nil)
		if err == nil {
			t.Fatalf("expected blue-green health check %q to fail", healthCheckURL.String)
		}
	}
}

func TestRemoteStepsGateBlueGreenPromotionOnHealthCheck(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "API Service",
		Strategy:        "blue_green",
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/api",
		HealthCheckUrl:  pgtype.Text{String: "https://api-{color}.example.com/healthz", Valid: true},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}

	labels := make([]string, 0, len(steps))
	for _, step := range steps {
		labels = append(labels, step.label)
	}
	joinedLabels := strings.Join(labels, "\n")
	if !strings.Contains(joinedLabels, "Checking next color health") {
		t.Fatalf("expected health check step, got %+v", labels)
	}

	joined := strings.Join(commands(steps), "\n")
	if !strings.Contains(joined, "curl -fsS --retry 10 --retry-delay 2") {
		t.Fatal("expected retrying health check command")
	}
	if !strings.Contains(joined, "sed \"s/{color}/$color/g\"") {
		t.Fatal("expected health check URL to resolve next color")
	}
	if strings.Index(joinedLabels, "Checking next color health") > strings.Index(joinedLabels, "Promoting next color") {
		t.Fatal("expected health check before promotion")
	}
}

func TestRemoteStepsWriteRuntimeEnvironment(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/app",
	}, []connectors.RuntimeVariable{
		{Key: "DATABASE_URL", Value: "postgres://user:pass@db/app"},
		{Key: "IGNORED-KEY", Value: "bad"},
	})
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(commands(steps), "\n")
	if !strings.Contains(joined, "umask 077") || !strings.Contains(joined, "> .env") {
		t.Fatal("expected locked-down runtime env write")
	}
	if !strings.Contains(joined, "DATABASE_URL=") {
		t.Fatal("expected valid runtime key")
	}
	if strings.Contains(joined, "IGNORED-KEY") {
		t.Fatal("did not expect invalid env key")
	}
}

func TestAppendArtifactVariablesAddsApplicationImageTag(t *testing.T) {
	variables := appendArtifactVariables(nil, db.GetDeploymentTargetRow{
		ApplicationName: "FinOps",
	}, remoteStepOptions{
		imageRef:    "us-east4-docker.pkg.dev/prosights-platform/internal/finops-api:sha-abc123",
		targetColor: "green",
	})

	values := map[string]string{}
	for _, variable := range variables {
		values[variable.Key] = variable.Value
	}
	if values["DEPLOY_IMAGE"] != "us-east4-docker.pkg.dev/prosights-platform/internal/finops-api:sha-abc123" {
		t.Fatalf("expected deploy image, got %+v", values)
	}
	if values["DEPLOY_IMAGE_TAG"] != "sha-abc123" || values["FINOPS_IMAGE_TAG"] != "sha-abc123" {
		t.Fatalf("expected generic and application image tag vars, got %+v", values)
	}
	if values["DEPLOY_COLOR"] != "green" {
		t.Fatalf("expected blue/green color var, got %+v", values)
	}
}

func TestRemoteStepsRejectRuntimeVariableNullBytes(t *testing.T) {
	_, err := remoteSteps(db.GetDeploymentTargetRow{
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/app",
	}, []connectors.RuntimeVariable{
		{Key: "DATABASE_URL", Value: "postgres://db\x00/app"},
	})
	if err == nil {
		t.Fatal("expected runtime variable null byte to fail")
	}
	if !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("expected variable name in error, got %v", err)
	}
}

func TestRemoteStepsRejectOversizedRuntimeVariableValues(t *testing.T) {
	_, err := remoteSteps(db.GetDeploymentTargetRow{
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/app",
	}, []connectors.RuntimeVariable{
		{Key: "DATABASE_URL", Value: strings.Repeat("x", maxRuntimeVariableValueLength+1)},
	})
	if err == nil {
		t.Fatal("expected oversized runtime variable value to fail")
	}
	if !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("expected variable name in error, got %v", err)
	}
}

func TestRenderRuntimeEnvFileRejectsOversizedEnvFiles(t *testing.T) {
	variables := make([]connectors.RuntimeVariable, 0, 10)
	for index := 0; index < 10; index++ {
		variables = append(variables, connectors.RuntimeVariable{
			Key:   fmt.Sprintf("VALUE_%d", index),
			Value: strings.Repeat("x", maxRuntimeVariableValueLength),
		})
	}

	_, err := renderRuntimeEnvFile(variables)
	if err == nil {
		t.Fatal("expected oversized runtime env file to fail")
	}
}

func TestRuntimeScopeUsesApplicationDopplerScope(t *testing.T) {
	scope := runtimeScope(db.GetDeploymentTargetRow{
		ApplicationName: "API",
		DopplerProject:  pgtype.Text{String: "billing", Valid: true},
		DopplerConfig:   pgtype.Text{String: "prd", Valid: true},
	})

	if scope.ApplicationName != "API" || scope.Project != "billing" || scope.Config != "prd" {
		t.Fatalf("unexpected runtime scope: %+v", scope)
	}
}

func TestRenderEnvFileQuotesValues(t *testing.T) {
	got := renderEnvFile([]connectors.RuntimeVariable{{Key: "SECRET", Value: "hello \"world\"\nnext"}})
	want := "SECRET=\"hello \\\"world\\\"\\nnext\"\n"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestRenderEnvFileSortsValidKeys(t *testing.T) {
	got := renderEnvFile([]connectors.RuntimeVariable{
		{Key: "Z_LAST", Value: "z"},
		{Key: "IGNORED-KEY", Value: "bad"},
		{Key: "A_FIRST", Value: "a"},
	})
	want := "A_FIRST=\"a\"\nZ_LAST=\"z\"\n"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestValidRuntimeVariableCountMatchesRenderedEnvKeys(t *testing.T) {
	variables := []connectors.RuntimeVariable{
		{Key: "DATABASE_URL", Value: "postgres://db"},
		{Key: "BAD-KEY", Value: "ignored"},
		{Key: "PUBLIC_URL", Value: "https://example.com"},
	}

	if got := validRuntimeVariableCount(variables); got != 2 {
		t.Fatalf("expected two valid runtime variables, got %d", got)
	}
	if rendered := renderEnvFile(variables); strings.Contains(rendered, "BAD-KEY") {
		t.Fatalf("rendered invalid key: %s", rendered)
	}
}

func commands(steps []remoteStep) []string {
	values := make([]string, 0, len(steps))
	for _, step := range steps {
		values = append(values, step.command)
	}
	return values
}
