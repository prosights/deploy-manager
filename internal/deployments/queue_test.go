package deployments

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"deploy-manager/internal/connectors"
	"deploy-manager/internal/db"
	"deploy-manager/internal/sshutil"

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

func TestRemoteStepsAuthenticateHTTPSFetchAndCloneInMemory(t *testing.T) {
	const header = "Authorization: Basic ephemeral"
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "API Service",
		RepositoryUrl:   pgtype.Text{String: "https://github.com/acme/app.git", Valid: true},
		Branch:          "main",
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/app",
	}, nil, remoteStepOptions{sourceAuthorizationHeader: header})
	if err != nil {
		t.Fatal(err)
	}

	var sync remoteStep
	for _, step := range steps {
		if step.label == "Syncing repository" {
			sync = step
			break
		}
	}
	if sync.input != header+"\n" {
		t.Fatalf("expected authorization header to be sent over protected input")
	}
	if strings.Contains(sync.command, header) || strings.Contains(sync.command, "https://x-access-token") {
		t.Fatalf("credential must not appear in the command line: %s", sync.command)
	}
	if !strings.Contains(sync.command, "IFS= read -r GIT_CONFIG_VALUE_0") || !strings.Contains(sync.command, "GIT_CONFIG_KEY_0=http.extraHeader") || !strings.Contains(sync.command, "git -c safe.directory='/srv/app' fetch") || !strings.Contains(sync.command, "git clone") {
		t.Fatalf("expected fetch and clone to inherit ephemeral config from stdin: %s", sync.command)
	}
}

func TestAuthenticatedSourceSyncReadsCredentialFromProtectedInput(t *testing.T) {
	root := t.TempDir()
	origin := filepath.Join(root, "origin.git")
	seed := filepath.Join(root, "seed")
	target := filepath.Join(root, "target")
	runGit(t, "init", "--bare", origin)
	runGit(t, "init", seed)
	runGit(t, "-C", seed, "config", "user.email", "test@example.com")
	runGit(t, "-C", seed, "config", "user.name", "Deploy Manager Test")
	if err := os.WriteFile(filepath.Join(seed, "README.md"), []byte("test\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGit(t, "-C", seed, "add", "README.md")
	runGit(t, "-C", seed, "commit", "-m", "initial")
	runGit(t, "-C", seed, "branch", "-M", "main")
	runGit(t, "-C", seed, "remote", "add", "origin", origin)
	runGit(t, "-C", seed, "push", "-u", "origin", "main")
	if err := os.MkdirAll(target, 0o700); err != nil {
		t.Fatal(err)
	}

	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "API Service",
		RepositoryUrl:   pgtype.Text{String: origin, Valid: true},
		Branch:          "main",
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: target,
	}, nil, remoteStepOptions{sourceAuthorizationHeader: "Authorization: Basic ZXBoZW1lcmFs"})
	if err != nil {
		t.Fatal(err)
	}
	var sync remoteStep
	for _, step := range steps {
		if step.label == "Syncing repository" {
			sync = step
			break
		}
	}
	if _, err := sshutil.NewLocalClient().RunWithInput(context.Background(), sync.command, sync.input); err != nil {
		t.Fatalf("run authenticated source sync: %v", err)
	}
	runGit(t, "-C", target, "rev-parse", "--verify", "HEAD")
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
	if strings.Contains(joined, "DEPLOY_COLOR=") || strings.Contains(joined, "DEPLOY_PORT=") {
		t.Fatalf("rolling deployments must preserve the original compose contract, got %s", joined)
	}
}

func TestBuildComposeDownCommandStopsRollingAndBlueGreenStacks(t *testing.T) {
	command, err := BuildComposeDownCommand(db.Application{
		ID:              pgtype.UUID{Bytes: [16]byte{1}, Valid: true},
		Name:            "billing api",
		Branch:          "main",
		ComposePath:     "services/api/compose.yml",
		RemoteDirectory: "/srv/apps/internal",
	}, []db.ListProxyRouteTargetsForApplicationRow{{
		BlueUpstreamUrl:  pgtype.Text{String: "http://127.0.0.1:3101", Valid: true},
		GreenUpstreamUrl: pgtype.Text{String: "http://127.0.0.1:3102", Valid: true},
	}})
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"docker compose -f 'services/api/compose.yml' down --remove-orphans",
		"DEPLOY_COLOR='blue' DEPLOY_PORT='3101'",
		"DEPLOY_COLOR='green' DEPLOY_PORT='3102'",
		"-blue'",
		"-green'",
	} {
		if !strings.Contains(command, expected) {
			t.Fatalf("expected cleanup command to contain %q, got %s", expected, command)
		}
	}
	if strings.Count(command, "down --remove-orphans") != 3 {
		t.Fatalf("expected rolling, blue, and green cleanup commands, got %s", command)
	}
}

func TestBuildComposeDownCommandExportsEachManagedRoutePort(t *testing.T) {
	command, err := BuildComposeDownCommand(db.Application{
		ID:              pgtype.UUID{Bytes: [16]byte{1}, Valid: true},
		Name:            "alleyes",
		Branch:          "main",
		ComposePath:     "alleyes-v2/compose.yml",
		RemoteDirectory: "/srv/apps/internal",
	}, []db.ListProxyRouteTargetsForApplicationRow{
		{
			BlueUpstreamUrl:  pgtype.Text{String: "http://127.0.0.1:3043", Valid: true},
			GreenUpstreamUrl: pgtype.Text{String: "http://127.0.0.1:3044", Valid: true},
			PortVariable:     pgtype.Text{String: "WEB_DEPLOY_PORT", Valid: true},
		},
		{
			BlueUpstreamUrl:  pgtype.Text{String: "http://127.0.0.1:8004", Valid: true},
			GreenUpstreamUrl: pgtype.Text{String: "http://127.0.0.1:8005", Valid: true},
			PortVariable:     pgtype.Text{String: "API_DEPLOY_PORT", Valid: true},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"API_DEPLOY_PORT='8004'",
		"API_DEPLOY_PORT='8005'",
		"WEB_DEPLOY_PORT='3043'",
		"WEB_DEPLOY_PORT='3044'",
	} {
		if !strings.Contains(command, expected) {
			t.Fatalf("expected cleanup command to contain %q, got %s", expected, command)
		}
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
	if strings.Contains(joined, "git clone") {
		t.Fatalf("did not expect an artifact deploy to sync source, got %s", joined)
	}
}

func TestRemoteStepsPullForArtifactFromDeploymentOptions(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "API Service",
		Strategy:        "blue_green",
		RepositoryUrl:   pgtype.Text{String: "git@github.com:acme/app.git", Valid: true},
		Branch:          "main",
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/app",
		HealthCheckUrl:  pgtype.Text{String: "http://127.0.0.1:{port}/{color}/health", Valid: true},
	}, nil, remoteStepOptions{imageRef: "ghcr.io/acme/app:1.0.0"})
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(commands(steps), "\n")
	if !strings.Contains(joined, "Pulling next color images") && !strings.Contains(joined, "docker compose -f 'docker-compose.yml' pull") {
		t.Fatalf("expected artifact deploy to pull the pinned image, got %s", joined)
	}
	if strings.Contains(joined, "git clone") || strings.Contains(joined, "build --pull") {
		t.Fatalf("did not expect artifact deploy to sync or build source, got %s", joined)
	}
}

func TestRemoteStepsSyncRepositoryAtArtifactCommit(t *testing.T) {
	const commit = "0123456789abcdef0123456789abcdef01234567"
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "API Service",
		RepositoryUrl:   pgtype.Text{String: "https://github.com/acme/app.git", Valid: true},
		Branch:          "main",
		CommitSha:       pgtype.Text{String: commit, Valid: true},
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/app",
	}, nil, remoteStepOptions{
		imageRef:                  "ghcr.io/acme/app:1.0.0",
		sourceAuthorizationHeader: "Authorization: Basic ephemeral",
	})
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(commands(steps), "\n")
	if !strings.Contains(joined, "git clone") || !strings.Contains(joined, "checkout --detach '"+commit+"'") {
		t.Fatalf("expected artifact deploy to sync the exact source commit, got %s", joined)
	}
	if strings.Contains(joined, "build --pull") {
		t.Fatalf("did not expect artifact deploy to build on the target, got %s", joined)
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
		HealthCheckUrl:  pgtype.Text{String: "http://127.0.0.1:{port}/healthz?color={color}", Valid: true},
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
		ApplicationID:   pgtype.UUID{Bytes: [16]byte{2}, Valid: true},
		ApplicationName: "API Service",
		Strategy:        "blue_green",
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/api",
		HealthCheckUrl:  pgtype.Text{String: "http://127.0.0.1:{port}/healthz?color={color}", Valid: true},
	}, nil, remoteStepOptions{bluePort: "4501", greenPort: "4502"})
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
	if strings.Count(joined, "DEPLOY_COLOR=$color DEPLOY_PORT=$port docker compose") != 3 {
		t.Fatalf("expected compose config, pull, and up to share the selected color and port, got %s", joined)
	}
	if !strings.Contains(joined, "${BLUE_DEPLOY_PORT:-4501}") || !strings.Contains(joined, "${GREEN_DEPLOY_PORT:-4502}") {
		t.Fatalf("expected the application port pair, got %s", joined)
	}
	if strings.Contains(joined, "3101") || strings.Contains(joined, "3102") {
		t.Fatalf("did not expect fallback ports when route ports are supplied, got %s", joined)
	}
}

func TestRemoteStepsPrepareSingletonServicesWithoutStartingThem(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "AllEyes",
		Strategy:        "blue_green",
		ComposePath:     "docker-compose.yml",
		RemoteDirectory: "/srv/alleyes",
		HealthCheckUrl:  pgtype.Text{String: "http://127.0.0.1:{port}/health?color={color}", Valid: true},
	}, nil, remoteStepOptions{singletonServices: []string{"monitoring-worker"}})
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(commands(steps), "\n")
	if !strings.Contains(joined, "--scale 'monitoring-worker=0'") {
		t.Fatalf("expected singleton worker to be scaled to zero in the standby color, got %s", joined)
	}
	if !strings.Contains(joined, "up --no-start --no-deps --no-build --force-recreate 'monitoring-worker'") {
		t.Fatalf("expected a stopped worker container to be prepared for promotion, got %s", joined)
	}
}

func TestRemoteStepsExportEachManagedRoutePort(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "AllEyes",
		Hostname:        "playground",
		Strategy:        "blue_green",
		ComposePath:     "compose.yml",
		RemoteDirectory: "/srv/alleyes",
		HealthCheckUrl:  pgtype.Text{String: "http://127.0.0.1:{port}/health?color={color}", Valid: true},
	}, nil, remoteStepOptions{
		bluePort:  "3043",
		greenPort: "3044",
		portVariables: []composePortVariable{
			{name: "WEB_DEPLOY_PORT", bluePort: "3043", greenPort: "3044"},
			{name: "API_DEPLOY_PORT", bluePort: "8004", greenPort: "8005"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(commands(steps), "\n")
	for _, expected := range []string{
		"API_DEPLOY_PORT=$(if [ \"$color\" = \"blue\" ]; then printf %s '8004'; else printf %s '8005'; fi)",
		"WEB_DEPLOY_PORT=$(if [ \"$color\" = \"blue\" ]; then printf %s '3043'; else printf %s '3044'; fi)",
	} {
		if strings.Count(joined, expected) != 3 {
			t.Fatalf("expected config, pull, and up to contain %q, got %s", expected, joined)
		}
	}
	if !strings.Contains(joined, "http://host.docker.internal:{port}/health?color={color}") {
		t.Fatalf("expected playground deploy health check to use the Docker host, got %s", joined)
	}
}

func TestRoutePortsPrefersLegacyDeployPortRoute(t *testing.T) {
	ports, err := routePorts([]db.ListProxyRouteTargetsForApplicationRow{
		{
			BlueUpstreamUrl:  pgtype.Text{String: "http://127.0.0.1:8004", Valid: true},
			GreenUpstreamUrl: pgtype.Text{String: "http://127.0.0.1:8005", Valid: true},
			PortVariable:     pgtype.Text{String: "API_DEPLOY_PORT", Valid: true},
		},
		{
			BlueUpstreamUrl:  pgtype.Text{String: "http://127.0.0.1:3043", Valid: true},
			GreenUpstreamUrl: pgtype.Text{String: "http://127.0.0.1:3044", Valid: true},
			PortVariable:     pgtype.Text{String: "DEPLOY_PORT", Valid: true},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if ports.blue != "3043" || ports.green != "3044" {
		t.Fatalf("expected DEPLOY_PORT route to remain the legacy pair, got %+v", ports)
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
		HealthCheckUrl:  pgtype.Text{String: "http://127.0.0.1:{port}/healthz?color={color}", Valid: true},
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
	if !strings.Contains(joined, "curl -fsS --retry 10 --retry-delay 2 --retry-all-errors") {
		t.Fatal("expected retrying health check command")
	}
	if !strings.Contains(joined, "sed \"s/{color}/$color/g\"") {
		t.Fatal("expected health check URL to resolve next color")
	}
	if !strings.Contains(joined, "sed \"s/{port}/$port/g\"") {
		t.Fatal("expected health check URL to resolve the next color's assigned port")
	}
	if strings.Contains(joinedLabels, "Promoting next color") {
		t.Fatal("route promotion must happen atomically after remote steps complete")
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
	if !strings.Contains(joined, "umask 077") || !strings.Contains(joined, "> '.env'") {
		t.Fatal("expected locked-down runtime env write")
	}
	if !strings.Contains(joined, "DATABASE_URL=") {
		t.Fatal("expected valid runtime key")
	}
	if strings.Contains(joined, "IGNORED-KEY") {
		t.Fatal("did not expect invalid env key")
	}
}

func TestRemoteStepsWriteRuntimeEnvironmentBesideNestedComposeFile(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ComposePath:     "evals/docker-compose.yml",
		RemoteDirectory: "/srv/app",
	}, []connectors.RuntimeVariable{{Key: "API_URL", Value: "https://api.example.com"}})
	if err != nil {
		t.Fatal(err)
	}
	if joined := strings.Join(commands(steps), "\n"); !strings.Contains(joined, "> 'evals/.env'") {
		t.Fatalf("expected runtime environment beside compose file, got %s", joined)
	}
}

func TestRemoteStepsClearRuntimeEnvironmentWhenVariablesAreRemoved(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "evals",
		ComposePath:     "evals/compose.yml",
		RemoteDirectory: "/srv/evals",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, step := range steps {
		if step.label == "Writing runtime environment" {
			if !strings.Contains(step.command, "printf %s '' > 'evals/.env'") {
				t.Fatalf("expected an empty managed environment file, got %s", step.command)
			}
			return
		}
	}
	t.Fatal("expected the managed environment file to be rewritten")
}

func TestRemoteStepsWriteAnIsolatedEnvironmentForEachConfiguredComposeService(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ComposePath:     "alleyes-v2/compose.yml",
		RemoteDirectory: "/srv/app",
	}, nil, remoteStepOptions{serviceVariables: map[string][]connectors.RuntimeVariable{
		"frontend": {
			{Key: "PUBLIC_API_URL", Value: "https://api.example.com"},
		},
		"worker": {
			{Key: "WORKER_CONCURRENCY", Value: "4"},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}

	var frontendCommand, workerCommand, overrideCommand string
	for _, step := range steps {
		switch step.label {
		case "Writing runtime environment for frontend":
			frontendCommand = step.command
		case "Writing runtime environment for worker":
			workerCommand = step.command
		case "Writing compose runtime override":
			overrideCommand = step.command
		}
	}
	if !strings.Contains(frontendCommand, "PUBLIC_API_URL=") || strings.Contains(frontendCommand, "WORKER_CONCURRENCY") {
		t.Fatalf("expected an isolated frontend env file, got %s", frontendCommand)
	}
	if !strings.Contains(workerCommand, "WORKER_CONCURRENCY=") || strings.Contains(workerCommand, "PUBLIC_API_URL") {
		t.Fatalf("expected an isolated worker env file, got %s", workerCommand)
	}
	if !strings.Contains(overrideCommand, ".deploy-manager/frontend.env") || !strings.Contains(overrideCommand, ".deploy-manager/worker.env") {
		t.Fatalf("expected both service env files in the compose override, got %s", overrideCommand)
	}

	joined := strings.Join(commands(steps), "\n")
	wantComposeFiles := "-f 'alleyes-v2/compose.yml' -f 'alleyes-v2/.deploy-manager.runtime.yml'"
	if !strings.Contains(joined, wantComposeFiles+" config --quiet") || !strings.Contains(joined, wantComposeFiles+" up -d --remove-orphans") {
		t.Fatalf("expected deploy commands to include the runtime override, got %s", joined)
	}
}

func TestRemoteStepsPublishManagedComposePorts(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{
		ApplicationName: "portal",
		ComposePath:     "compose.yml",
		RemoteDirectory: "/srv/app",
		Strategy:        "blue_green",
		HealthCheckUrl:  pgtype.Text{String: "http://127.0.0.1:{port}/health?color={color}", Valid: true},
	}, nil, remoteStepOptions{
		targetColor: "blue",
		portVariables: []composePortVariable{{
			name:          "DEPLOY_MANAGER_WEB_3000_PORT",
			bluePort:      "20000",
			greenPort:     "20001",
			serviceName:   "web",
			containerPort: 3000,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(commands(steps), "\n")
	if !strings.Contains(joined, "ports: !override") || !strings.Contains(joined, "127.0.0.1:${DEPLOY_MANAGER_WEB_3000_PORT:?DEPLOY_MANAGER_WEB_3000_PORT is required}:3000") {
		t.Fatalf("expected a managed compose port override, got %s", joined)
	}
	if !strings.Contains(joined, "DEPLOY_MANAGER_WEB_3000_PORT=$(if") || !strings.Contains(joined, "-f 'compose.yml' -f '.deploy-manager.runtime.yml'") {
		t.Fatalf("expected managed ports on compose commands, got %s", joined)
	}
}

func TestRemoteStepsExposeManagedPortsToTheLocalPlaygroundNetwork(t *testing.T) {
	steps, err := remoteSteps(db.GetDeploymentTargetRow{Hostname: "playground", ComposePath: "compose.yml", RemoteDirectory: "/srv/app"}, nil, remoteStepOptions{portVariables: []composePortVariable{{name: "DEPLOY_PORT", serviceName: "web", containerPort: 80}}})
	if err != nil {
		t.Fatal(err)
	}
	if joined := strings.Join(commands(steps), "\n"); !strings.Contains(joined, `0.0.0.0:${DEPLOY_PORT:?DEPLOY_PORT is required}:80`) {
		t.Fatalf("expected the playground proxy and health check to reach the managed port, got %s", joined)
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

func runGit(t *testing.T, args ...string) {
	t.Helper()
	command := exec.Command("git", args...)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, output)
	}
}
