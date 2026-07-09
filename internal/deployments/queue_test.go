package deployments

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
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

func testRuntimeInjection() remoteStepOptions {
	return remoteStepOptions{injection: connectors.RuntimeInjection{
		Project: "billing",
		Config:  "prd",
		Token:   "dp.st.prd.test-secret",
	}}
}

const testDopplerRunPrefix = "doppler run --project 'billing' --config 'prd' --no-fallback --"

func TestRemoteStepsUseRepositoryWhenConfigured(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "API Service",
		RepositoryUrl:   pgtype.Text{String: "git@github.com:acme/app.git", Valid: true},
		Branch:          "main",
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/app",
	}, testRuntimeInjection())
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
	}, testRuntimeInjection())
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

func TestRemoteStepsRequireDopplerRuntimeInjection(t *testing.T) {
	target := db.GetDeploymentTargetRow{
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/app",
	}

	if _, err := remoteSteps(target); err == nil || !strings.Contains(err.Error(), "doppler runtime injection is required") {
		t.Fatalf("expected missing injection to fail, got %v", err)
	}
	for name, injection := range map[string]connectors.RuntimeInjection{
		"missing config":  {Project: "billing"},
		"missing project": {Config: "prd"},
		"control chars":   {Project: "bil\nling", Config: "prd"},
	} {
		if _, err := remoteSteps(target, remoteStepOptions{injection: injection}); err == nil {
			t.Fatalf("expected %s injection to fail", name)
		}
	}
}

func TestRemoteStepsNeverWriteEnvFilesOnTarget(t *testing.T) {
	for _, target := range []db.GetDeploymentTargetRow{
		{
			ApplicationName: "API Service",
			ComposePath:     "docker-compose.yml",
			RemoteDirectory: "/srv/app",
			ImageRef:        pgtype.Text{String: "ghcr.io/acme/app:1.0.0", Valid: true},
		},
		{
			ApplicationName: "API Service",
			Strategy:        "blue_green",
			ComposePath:     "docker-compose.yml",
			RemoteDirectory: "/srv/app",
			HealthCheckUrl:  pgtype.Text{String: "https://api-{color}.example.com/healthz", Valid: true},
		},
	} {
		steps, err := remoteSteps(target, testRuntimeInjection())
		if err != nil {
			t.Fatal(err)
		}

		joined := strings.Join(commands(steps), "\n")
		if strings.Contains(joined, "> .env") || strings.Contains(joined, ">.env") {
			t.Fatalf("no step may write an env file on the target, got %s", joined)
		}
		if !strings.Contains(joined, "rm -f './.env'") {
			t.Fatalf("expected legacy env files to be removed, got %s", joined)
		}
		if !strings.Contains(joined, "env_file") || !strings.Contains(joined, "env_file is not allowed") {
			t.Fatalf("expected env_file usage to be rejected, got %s", joined)
		}
		if !strings.Contains(joined, "command -v doppler") {
			t.Fatalf("expected doppler CLI presence check, got %s", joined)
		}
	}
}

func TestRemoteStepsWrapAllComposeCommandsInDopplerRun(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "API Service",
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/app",
		ImageRef:        pgtype.Text{String: "ghcr.io/acme/app:1.0.0", Valid: true},
	}, testRuntimeInjection())
	if err != nil {
		t.Fatal(err)
	}

	composeSteps := 0
	for _, step := range steps {
		if !strings.Contains(step.command, "docker compose") {
			if step.needsDopplerToken {
				t.Fatalf("step %q must not request a doppler token", step.label)
			}
			continue
		}
		composeSteps++
		if !strings.Contains(step.command, testDopplerRunPrefix) {
			t.Fatalf("compose step %q must run under doppler run, got %s", step.label, step.command)
		}
		if !step.needsDopplerToken {
			t.Fatalf("compose step %q must read the doppler token from stdin", step.label)
		}
		if !strings.Contains(step.command, "IFS= read -r DOPPLER_TOKEN") {
			t.Fatalf("compose step %q must consume the token from stdin, got %s", step.label, step.command)
		}
	}
	if composeSteps < 3 {
		t.Fatalf("expected config, pull, and up compose steps, got %d", composeSteps)
	}
}

func TestRemoteStepsKeepServiceTokenOffCommandLines(t *testing.T) {
	options := testRuntimeInjection()
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "API Service",
		Strategy:        "blue_green",
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/api",
		HealthCheckUrl:  pgtype.Text{String: "https://api-{color}.example.com/healthz", Valid: true},
	}, options)
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(commands(steps), "\n")
	if strings.Contains(joined, options.injection.Token) {
		t.Fatal("the doppler service token must never appear in a remote command line")
	}
}

func TestRemoteStepsPassArtifactVariablesInlineAfterInjection(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "FinOps",
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/finops",
		ImageRef:        pgtype.Text{String: "ghcr.io/acme/finops:sha-abc123", Valid: true},
	}, testRuntimeInjection())
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(commands(steps), "\n")
	for _, expected := range []string{
		"DEPLOY_IMAGE='ghcr.io/acme/finops:sha-abc123'",
		"DEPLOY_IMAGE_TAG='sha-abc123'",
		"FINOPS_IMAGE_TAG='sha-abc123'",
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("expected inline artifact assignment %q, got %s", expected, joined)
		}
	}
	if !strings.Contains(joined, "-- env DEPLOY_IMAGE=") {
		t.Fatalf("expected artifact variables to be applied after doppler injection, got %s", joined)
	}
}

func TestRemoteStepsEnforceGuardBeforeComposeSteps(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/app",
	}, testRuntimeInjection())
	if err != nil {
		t.Fatal(err)
	}

	labels := make([]string, 0, len(steps))
	for _, step := range steps {
		labels = append(labels, step.label)
	}
	joinedLabels := strings.Join(labels, "\n")
	guardIndex := strings.Index(joinedLabels, "Enforcing Doppler-only runtime environment")
	if guardIndex < 0 {
		t.Fatalf("expected enforcement step, got %+v", labels)
	}
	if guardIndex > strings.Index(joinedLabels, "Validating compose config") {
		t.Fatalf("expected enforcement before compose validation, got %+v", labels)
	}
}

func TestRemoteStepsRemoveEnvFileNextToNestedComposePath(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ComposePath:     "deploy/docker-compose.yml",
		RemoteDirectory: "/srv/app",
	}, testRuntimeInjection())
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(commands(steps), "\n")
	if !strings.Contains(joined, "rm -f './.env' './deploy/.env'") {
		t.Fatalf("expected env file removal next to compose file, got %s", joined)
	}
}

func TestRemoteStepsCheckoutDeploymentCommitWhenConfigured(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		RepositoryUrl:   pgtype.Text{String: "git@github.com:acme/app.git", Valid: true},
		Branch:          "main",
		CommitSha:       pgtype.Text{String: "abc1234", Valid: true},
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/app",
	}, testRuntimeInjection())
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
	}, testRuntimeInjection())
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
			}, testRuntimeInjection())
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
		}, testRuntimeInjection())
		if err == nil {
			t.Fatalf("expected remote directory %q to fail", remoteDir)
		}
	}
}

func TestRemoteStepsRejectBlankComposePath(t *testing.T) {
	_, err := remoteSteps(db.GetDeploymentTargetRow{
		RemoteDirectory: "/srv/app",
	}, testRuntimeInjection())
	if err == nil {
		t.Fatal("expected blank compose path to fail")
	}
}

func TestRemoteStepsRejectUnsafeComposePath(t *testing.T) {
	for _, composePath := range []string{"/srv/app/docker-compose.yml", "../docker-compose.yml", "deploy/../docker-compose.yml", "."} {
		_, err := remoteSteps(db.GetDeploymentTargetRow{
			ComposePath:     composePath,
			RemoteDirectory: "/srv/app",
		}, testRuntimeInjection())
		if err == nil {
			t.Fatalf("expected compose path %q to fail", composePath)
		}
	}
}

func TestRemoteStepsSkipRepositoryWhenNotConfigured(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ComposePath:     "compose.yml",
		RemoteDirectory: "/srv/app",
	}, testRuntimeInjection())
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
	}, testRuntimeInjection())
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
	}, testRuntimeInjection())
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
	}, testRuntimeInjection())
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
	}, testRuntimeInjection())
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(commands(steps), "\n")
	if !strings.Contains(joined, ".deploy-manager-next-color") {
		t.Fatal("expected blue-green color selection")
	}
	if !strings.Contains(joined, "COMPOSE_PROJECT_NAME='api-service'-$color DEPLOY_COLOR=$color DEPLOY_PORT=$port") {
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
	}, testRuntimeInjection())
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
	}, testRuntimeInjection())
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
		}, testRuntimeInjection())
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
	}, testRuntimeInjection())
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

func TestArtifactVariablesAddApplicationImageTag(t *testing.T) {
	variables := artifactVariables(db.GetDeploymentTargetRow{
		ApplicationName: "FinOps",
	}, remoteStepOptions{
		imageRef: "us-east4-docker.pkg.dev/prosights-platform/internal/finops-api:sha-abc123",
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
}

func TestRemoteStepsRejectArtifactVariableNullBytes(t *testing.T) {
	_, err := remoteSteps(db.GetDeploymentTargetRow{
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/app",
	}, remoteStepOptions{
		imageRef:  "ghcr.io/acme/app\x001.0.0",
		injection: testRuntimeInjection().injection,
	})
	if err == nil {
		t.Fatal("expected artifact variable null byte to fail")
	}
	if !strings.Contains(err.Error(), "DEPLOY_IMAGE") {
		t.Fatalf("expected variable name in error, got %v", err)
	}
}

func TestRemoteStepsRejectOversizedArtifactVariableValues(t *testing.T) {
	_, err := remoteSteps(db.GetDeploymentTargetRow{
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/app",
	}, remoteStepOptions{
		imageRef:  "ghcr.io/acme/" + strings.Repeat("x", maxRuntimeVariableValueLength+1),
		injection: testRuntimeInjection().injection,
	})
	if err == nil {
		t.Fatal("expected oversized artifact variable value to fail")
	}
	if !strings.Contains(err.Error(), "DEPLOY_IMAGE") {
		t.Fatalf("expected variable name in error, got %v", err)
	}
}

func TestRenderEnvAssignmentsSortsAndSkipsInvalidKeys(t *testing.T) {
	got, err := renderEnvAssignments([]connectors.RuntimeVariable{
		{Key: "Z_LAST", Value: "z"},
		{Key: "IGNORED-KEY", Value: "bad"},
		{Key: "A_FIRST", Value: "a b"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got != " A_FIRST='a b' Z_LAST='z'" {
		t.Fatalf("unexpected env assignments: %q", got)
	}
}

func TestRemoteStepCommandsAreValidShell(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("sh not available")
	}

	for name, target := range map[string]db.GetDeploymentTargetRow{
		"rolling artifact": {
			ApplicationName: "API Service",
			ComposePath:     "docker-compose.yml",
			RemoteDirectory: "/srv/app",
			ImageRef:        pgtype.Text{String: "ghcr.io/acme/app:1.0.0", Valid: true},
		},
		"rolling source": {
			ApplicationName: "API Service",
			RepositoryUrl:   pgtype.Text{String: "git@github.com:acme/app.git", Valid: true},
			Branch:          "main",
			ComposePath:     "docker-compose.yml",
			RemoteDirectory: "/srv/app",
		},
		"blue green": {
			ApplicationName: "API Service",
			Strategy:        "blue_green",
			ComposePath:     "deploy/docker-compose.yml",
			RemoteDirectory: "/srv/api",
			ImageRef:        pgtype.Text{String: "ghcr.io/acme/app:1.0.0", Valid: true},
			HealthCheckUrl:  pgtype.Text{String: "https://api-{color}.example.com/healthz", Valid: true},
		},
	} {
		t.Run(name, func(t *testing.T) {
			steps, err := remoteSteps(target, testRuntimeInjection())
			if err != nil {
				t.Fatal(err)
			}
			for _, step := range steps {
				output, err := exec.Command("sh", "-n", "-c", step.command).CombinedOutput()
				if err != nil {
					t.Fatalf("step %q is not valid shell: %v: %s\ncommand: %s", step.label, err, output, step.command)
				}
			}
		})
	}
}

func TestEnforceDopplerOnlyStepRemovesEnvFilesAndRejectsEnvFileDirectives(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("sh not available")
	}

	binDir := t.TempDir()
	fakeDoppler := filepath.Join(binDir, "doppler")
	if err := os.WriteFile(fakeDoppler, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	run := func(remoteDir string) (string, error) {
		step := enforceDopplerOnlyStep(db.GetDeploymentTargetRow{
			RemoteDirectory: remoteDir,
			ComposePath:     "docker-compose.yml",
		})
		cmd := exec.Command("sh", "-c", step.command)
		cmd.Env = append(os.Environ(), "PATH="+binDir+":"+os.Getenv("PATH"))
		output, err := cmd.CombinedOutput()
		return string(output), err
	}

	t.Run("removes stray env files", func(t *testing.T) {
		remoteDir := t.TempDir()
		if err := os.WriteFile(filepath.Join(remoteDir, "docker-compose.yml"), []byte("services: {}\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(remoteDir, ".env"), []byte("SECRET=leak\n"), 0o600); err != nil {
			t.Fatal(err)
		}

		if output, err := run(remoteDir); err != nil {
			t.Fatalf("expected guard to pass, got %v: %s", err, output)
		}
		if _, err := os.Stat(filepath.Join(remoteDir, ".env")); !os.IsNotExist(err) {
			t.Fatal("expected stray .env to be removed from the target")
		}
	})

	t.Run("rejects env_file directives", func(t *testing.T) {
		remoteDir := t.TempDir()
		compose := "services:\n  app:\n    image: x\n    env_file:\n      - .env\n"
		if err := os.WriteFile(filepath.Join(remoteDir, "docker-compose.yml"), []byte(compose), 0o644); err != nil {
			t.Fatal(err)
		}

		output, err := run(remoteDir)
		if err == nil {
			t.Fatalf("expected guard to reject env_file, got success: %s", output)
		}
		if !strings.Contains(output, "env_file is not allowed") {
			t.Fatalf("expected env_file rejection message, got %s", output)
		}
	})

	t.Run("fails without compose file", func(t *testing.T) {
		output, err := run(t.TempDir())
		if err == nil {
			t.Fatalf("expected guard to fail without compose file, got success: %s", output)
		}
	})
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

func commands(steps []remoteStep) []string {
	values := make([]string, 0, len(steps))
	for _, step := range steps {
		values = append(values, step.command)
	}
	return values
}
