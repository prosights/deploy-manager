package deployments

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"deploy-manager/internal/auditlog"
	"deploy-manager/internal/connectors"
	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestRunnerStopsWhenDeploymentCannotBeMarkedRunning(t *testing.T) {
	deploymentID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	queries := &fakeRunnerQueries{startErr: errors.New("database unavailable")}
	runner := NewRunner(queries, NewLogBus(nil), nil, nil)

	runner.Run(context.Background(), db.Deployment{ID: deploymentID, Status: "queued"})

	if queries.targetLoads != 0 {
		t.Fatal("did not expect runner to load target after status transition failed")
	}
	if queries.startAttempts != 1 {
		t.Fatalf("expected one start attempt, got %d", queries.startAttempts)
	}
	if len(queries.logs) != 1 || queries.logs[0].Stream != "stderr" {
		t.Fatalf("expected status transition failure log, got %+v", queries.logs)
	}
}

func TestRunnerSkipsDeploymentThatIsNoLongerQueued(t *testing.T) {
	deploymentID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	queries := &fakeRunnerQueries{startErr: pgx.ErrNoRows}
	runner := NewRunner(queries, NewLogBus(nil), nil, nil)

	runner.Run(context.Background(), db.Deployment{ID: deploymentID, Status: "queued"})

	if queries.targetLoads != 0 {
		t.Fatal("did not expect runner to load target for non-queued deployment")
	}
	if len(queries.logs) != 1 || !strings.Contains(queries.logs[0].Message, "no longer queued") {
		t.Fatalf("expected skipped deployment log, got %+v", queries.logs)
	}
}

func TestRunnerMarksApplicationDeployingWithTargetVersion(t *testing.T) {
	applicationID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	deploymentID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	queries := &fakeRunnerQueries{
		target: db.GetDeploymentTargetRow{
			ApplicationID:   applicationID,
			ApplicationName: "api",
			ServerName:      "prod-1",
			CommitSha:       pgtype.Text{String: "abc1234", Valid: true},
		},
	}
	runner := NewRunner(queries, NewLogBus(nil), nil, nil)

	runner.Run(context.Background(), db.Deployment{ID: deploymentID, Status: "queued"})

	if len(queries.applicationStatuses) < 1 {
		t.Fatal("expected application status update")
	}
	first := queries.applicationStatuses[0]
	if first.Status != "deploying" || !first.Version.Valid || first.Version.String != "abc1234" {
		t.Fatalf("expected deploying target version, got %+v", first)
	}
}

func TestRunnerAuditsLifecycleStatusChanges(t *testing.T) {
	applicationID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	deploymentID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	queries := &fakeRunnerQueries{
		target: db.GetDeploymentTargetRow{
			ApplicationID:   applicationID,
			ApplicationName: "api",
			ServerName:      "prod-1",
			Strategy:        "rolling",
		},
		startDeployment: db.Deployment{
			ID:            deploymentID,
			ApplicationID: applicationID,
			Status:        "running",
			Trigger:       "manual",
			Strategy:      "rolling",
			Actor:         pgtype.Text{String: "ali", Valid: true},
		},
	}
	runner := NewRunner(queries, NewLogBus(nil), nil, nil)

	runner.Run(context.Background(), db.Deployment{ID: deploymentID, Status: "queued"})

	if !containsAudit(queries.auditEvents, "deployment.running") {
		t.Fatalf("expected running audit event, got %+v", queries.auditEvents)
	}
	if !containsAudit(queries.auditEvents, "deployment.failed") {
		t.Fatalf("expected failed audit event, got %+v", queries.auditEvents)
	}
	if queries.auditEvents[0].Actor != "ali" {
		t.Fatalf("expected deployment actor to be preserved, got %+v", queries.auditEvents[0])
	}
	if !strings.Contains(string(queries.auditEvents[1].Metadata), "server prod-1 has no ssh key path configured") {
		t.Fatalf("expected failure metadata, got %s", queries.auditEvents[1].Metadata)
	}
}

func TestRunnerAuditMetadataRedactsSecretLikeKeys(t *testing.T) {
	deploymentID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	queries := &fakeRunnerQueries{}
	runner := NewRunner(queries, NewLogBus(nil), nil, nil)

	runner.audit(context.Background(), db.Deployment{ID: deploymentID}, db.GetDeploymentTargetRow{
		ApplicationName: "api",
	}, "deployment.failed", map[string]any{
		"apiToken": "secret",
		"error":    strings.Repeat("x", auditlog.MaxStringLength+1),
	})

	if len(queries.auditEvents) != 1 {
		t.Fatalf("expected one audit event, got %+v", queries.auditEvents)
	}
	metadata := string(queries.auditEvents[0].Metadata)
	if strings.Contains(metadata, "secret") || !strings.Contains(metadata, "[redacted]") {
		t.Fatalf("expected secret metadata to be redacted, got %s", metadata)
	}
	if strings.Contains(metadata, strings.Repeat("x", auditlog.MaxStringLength+1)) {
		t.Fatalf("expected long metadata strings to be bounded, got %s", metadata)
	}
}

func TestRunnerSkipsBlankDeploymentLogs(t *testing.T) {
	deploymentID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	queries := &fakeRunnerQueries{}
	runner := NewRunner(queries, NewLogBus(nil), nil, nil)

	runner.append(context.Background(), db.Deployment{ID: deploymentID}, "stdout", " \n\t ")

	if len(queries.logs) != 0 {
		t.Fatalf("expected blank deployment log to be skipped, got %+v", queries.logs)
	}
}

func TestRunnerBoundsDeploymentLogMessages(t *testing.T) {
	deploymentID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	queries := &fakeRunnerQueries{}
	runner := NewRunner(queries, NewLogBus(nil), nil, nil)

	runner.append(context.Background(), db.Deployment{ID: deploymentID}, "stdout", strings.Repeat("x", maxDeploymentLogMessageLength+1))

	if len(queries.logs) != 1 {
		t.Fatalf("expected one bounded deployment log, got %+v", queries.logs)
	}
	message := queries.logs[0].Message
	if len([]rune(message)) != maxDeploymentLogMessageLength {
		t.Fatalf("expected deployment log length %d, got %d", maxDeploymentLogMessageLength, len([]rune(message)))
	}
	if !strings.HasSuffix(message, deploymentLogTruncatedMarker) {
		t.Fatalf("expected deployment log truncation marker, got %q", message[len(message)-32:])
	}
}

func TestRunnerRedactsDeploymentLogMessages(t *testing.T) {
	deploymentID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	queries := &fakeRunnerQueries{}
	runner := NewRunner(queries, NewLogBus(nil), nil, nil)

	runner.append(context.Background(), db.Deployment{ID: deploymentID}, "stdout", "token ghp_1234567890abcdef")

	if len(queries.logs) != 1 {
		t.Fatalf("expected one deployment log, got %+v", queries.logs)
	}
	if strings.Contains(queries.logs[0].Message, "ghp_1234567890abcdef") || !strings.Contains(queries.logs[0].Message, "[redacted]") {
		t.Fatalf("expected redacted deployment log, got %q", queries.logs[0].Message)
	}
}

func TestRunnerDoesNotMarkApplicationHealthyWhenSucceededStatusCannotPersist(t *testing.T) {
	applicationID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	deploymentID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	queries := &fakeRunnerQueries{
		deploymentStatusErr: errors.New("database unavailable"),
	}
	runner := NewRunner(queries, NewLogBus(nil), nil, nil)

	runner.complete(context.Background(), db.Deployment{ID: deploymentID, Status: "running"}, db.GetDeploymentTargetRow{
		ApplicationID:   applicationID,
		ApplicationName: "api",
		ServerName:      "prod-1",
		CommitSha:       pgtype.Text{String: "abc1234", Valid: true},
	})

	for _, status := range queries.applicationStatuses {
		if status.Status == "healthy" {
			t.Fatalf("did not expect application to be marked healthy after failed status update: %+v", queries.applicationStatuses)
		}
	}
	if !containsLog(queries.logs, "mark deployment succeeded: database unavailable") {
		t.Fatalf("expected persisted status failure log, got %+v", queries.logs)
	}
}

func TestRunnerAuditsSuccessfulCompletion(t *testing.T) {
	deploymentID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	applicationID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	queries := &fakeRunnerQueries{}
	runner := NewRunner(queries, NewLogBus(nil), nil, nil)

	runner.complete(context.Background(), db.Deployment{
		ID:     deploymentID,
		Status: "running",
	}, db.GetDeploymentTargetRow{
		ApplicationID:                applicationID,
		ApplicationName:              "api",
		ConfigurationRevision:        4,
		ProjectConfigurationRevision: 7,
	})

	if !containsAudit(queries.auditEvents, "deployment.succeeded") {
		t.Fatalf("expected succeeded audit event, got %+v", queries.auditEvents)
	}
	if len(queries.deployedConfigurations) != 1 {
		t.Fatalf("expected deployed configuration revision to be recorded, got %+v", queries.deployedConfigurations)
	}
	marked := queries.deployedConfigurations[0]
	if marked.ID != applicationID || marked.ConfigurationRevision != 4 || marked.ProjectConfigurationRevision != 7 {
		t.Fatalf("unexpected deployed configuration revision: %+v", marked)
	}
}

func TestRunnerDoesNotMarkConfigurationDeployedForRollback(t *testing.T) {
	queries := &fakeRunnerQueries{}
	runner := NewRunner(queries, NewLogBus(nil), nil, nil)

	runner.complete(context.Background(), db.Deployment{
		ID:      pgtype.UUID{Bytes: [16]byte{1}, Valid: true},
		Status:  "running",
		Trigger: "rollback",
	}, db.GetDeploymentTargetRow{
		ApplicationID:                pgtype.UUID{Bytes: [16]byte{2}, Valid: true},
		ConfigurationRevision:        4,
		ProjectConfigurationRevision: 7,
	})

	if len(queries.deployedConfigurations) != 0 {
		t.Fatalf("did not expect rollback to mark current configuration deployed: %+v", queries.deployedConfigurations)
	}
}

func TestDeploymentRuntimeVariablesUseDopplerOverrides(t *testing.T) {
	queries := &fakeRunnerQueries{projectRuntimeVariables: []db.ProjectRuntimeVariable{
		{Key: "APP_ENV", Value: "production"},
		{Key: "DATABASE_URL", Value: "project-default"},
	}}
	runner := NewRunner(queries, NewLogBus(nil), nil, fakeRuntimeVariableSource{variables: []connectors.RuntimeVariable{
		{Key: "DATABASE_URL", Value: "doppler-secret"},
		{Key: "TOKEN", Value: "doppler-token"},
	}})

	variables, err := runner.deploymentRuntimeVariables(context.Background(), db.GetDeploymentTargetRow{
		ApplicationID: pgtype.UUID{Bytes: [16]byte{1}, Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}

	want := []connectors.RuntimeVariable{
		{Key: "APP_ENV", Value: "production"},
		{Key: "DATABASE_URL", Value: "doppler-secret"},
		{Key: "TOKEN", Value: "doppler-token"},
	}
	if !reflect.DeepEqual(variables, want) {
		t.Fatalf("expected Doppler values to override project defaults, got %+v", variables)
	}
}

func TestDeploymentServiceRuntimeVariablesAreIsolatedAndCanOverrideSharedValues(t *testing.T) {
	queries := &fakeRunnerQueries{serviceRuntimeConfigs: []db.ApplicationServiceRuntimeConfig{
		{
			ComposeService: stackRuntimeConfigName,
			DopplerProject: pgtype.Text{String: "alleyes-shared", Valid: true},
			DopplerConfig:  pgtype.Text{String: "prd", Valid: true},
			Variables:      []byte(`[{"key":"SHARED","value":"stack-default"},{"key":"STACK_ONLY","value":"all-services"}]`),
		},
		{
			ComposeService: "frontend",
			DopplerProject: pgtype.Text{String: "alleyes-web", Valid: true},
			DopplerConfig:  pgtype.Text{String: "prd", Valid: true},
			Variables:      []byte(`[{"key":"PUBLIC_API_URL","value":"https://api.example.com"},{"key":"SHARED","value":"frontend-direct"}]`),
		},
		{
			ComposeService: "worker",
			Variables:      []byte(`[{"key":"WORKER_CONCURRENCY","value":"4"}]`),
		},
	}}
	runtime := &scopedRuntimeVariableSource{variables: map[string][]connectors.RuntimeVariable{
		"alleyes-shared/prd": {
			{Key: "SHARED", Value: "stack-doppler"},
			{Key: "STACK_SECRET", Value: "shared-secret"},
		},
		"alleyes-web/prd": {
			{Key: "API_TOKEN", Value: "doppler-secret"},
			{Key: "SHARED", Value: "frontend-doppler"},
		},
	}}
	runner := NewRunner(queries, NewLogBus(nil), nil, runtime)

	services, err := runner.deploymentServiceRuntimeVariables(context.Background(), db.GetDeploymentTargetRow{
		ApplicationName: "alleyes",
		ApplicationID:   pgtype.UUID{Bytes: [16]byte{1}, Valid: true},
		ComposeServices: []byte(`[{"name":"frontend"},{"name":"worker"},{"name":"scheduler"}]`),
	}, []connectors.RuntimeVariable{
		{Key: "GLOBAL", Value: "shared"},
		{Key: "SHARED", Value: "project-default"},
	})
	if err != nil {
		t.Fatal(err)
	}

	wantFrontend := []connectors.RuntimeVariable{
		{Key: "API_TOKEN", Value: "doppler-secret"},
		{Key: "GLOBAL", Value: "shared"},
		{Key: "PUBLIC_API_URL", Value: "https://api.example.com"},
		{Key: "SHARED", Value: "frontend-doppler"},
		{Key: "STACK_ONLY", Value: "all-services"},
		{Key: "STACK_SECRET", Value: "shared-secret"},
	}
	wantWorker := []connectors.RuntimeVariable{
		{Key: "GLOBAL", Value: "shared"},
		{Key: "SHARED", Value: "stack-doppler"},
		{Key: "STACK_ONLY", Value: "all-services"},
		{Key: "STACK_SECRET", Value: "shared-secret"},
		{Key: "WORKER_CONCURRENCY", Value: "4"},
	}
	if !reflect.DeepEqual(services["frontend"], wantFrontend) {
		t.Fatalf("unexpected frontend variables: %+v", services["frontend"])
	}
	if !reflect.DeepEqual(services["worker"], wantWorker) {
		t.Fatalf("unexpected worker variables: %+v", services["worker"])
	}
	wantScheduler := []connectors.RuntimeVariable{{Key: "GLOBAL", Value: "shared"}, {Key: "SHARED", Value: "stack-doppler"}, {Key: "STACK_ONLY", Value: "all-services"}, {Key: "STACK_SECRET", Value: "shared-secret"}}
	if !reflect.DeepEqual(services["scheduler"], wantScheduler) {
		t.Fatalf("unexpected scheduler variables: %+v", services["scheduler"])
	}
	if len(runtime.scopes) != 2 || runtime.scopes[0].ApplicationName != "alleyes/stack" || runtime.scopes[1].ApplicationName != "alleyes/frontend" {
		t.Fatalf("expected stack and frontend Doppler scopes to be fetched, got %+v", runtime.scopes)
	}
}

func TestResolveSourceCommitPinsDeploymentRevision(t *testing.T) {
	const commit = "0123456789abcdef0123456789abcdef01234567"
	const message = "Show deployment commit subjects"
	queries := &fakeRunnerQueries{}
	runner := NewRunner(queries, NewLogBus(nil), nil, nil)
	target := db.GetDeploymentTargetRow{RemoteDirectory: "/srv/app"}

	err := runner.resolveSourceCommit(context.Background(), db.Deployment{ID: pgtype.UUID{Bytes: [16]byte{1}, Valid: true}}, &target, &fakeRemoteRunner{output: commit + "\n" + message + "\n"})
	if err != nil {
		t.Fatal(err)
	}
	if queries.deploymentCommit != commit || queries.deploymentCommitMessage != message || target.CommitSha.String != commit || !target.CommitSha.Valid {
		t.Fatalf("expected resolved commit to be persisted, got query=%q message=%q target=%+v", queries.deploymentCommit, queries.deploymentCommitMessage, target.CommitSha)
	}
}

func TestDeploymentActorDefaultsToSystem(t *testing.T) {
	if actor := deploymentActor(db.Deployment{}); actor != "system" {
		t.Fatalf("expected system actor, got %q", actor)
	}
}

func TestCheckColorHealthUsesApplicationPortPair(t *testing.T) {
	runner := NewRunner(&fakeRunnerQueries{proxyRoutes: []db.ListProxyRouteTargetsForApplicationRow{{
		BlueUpstreamUrl:  pgtype.Text{String: "http://127.0.0.1:5201", Valid: true},
		GreenUpstreamUrl: pgtype.Text{String: "http://127.0.0.1:5202", Valid: true},
	}}}, NewLogBus(nil), nil, nil)
	remote := &fakeRemoteRunner{}

	err := runner.checkColorHealth(context.Background(), db.GetDeploymentTargetRow{
		Strategy:       "blue_green",
		HealthCheckUrl: pgtype.Text{String: "http://127.0.0.1:{port}/{color}/health", Valid: true},
	}, remote, "green")
	if err != nil {
		t.Fatal(err)
	}
	if len(remote.commands) != 1 || !strings.Contains(remote.commands[0], "http://127.0.0.1:5202/green/health") {
		t.Fatalf("expected green health check to use the route port, got %+v", remote.commands)
	}
}

func TestCheckColorHealthUsesDockerHostOnlyForPlayground(t *testing.T) {
	runner := NewRunner(&fakeRunnerQueries{proxyRoutes: []db.ListProxyRouteTargetsForApplicationRow{{
		BlueUpstreamUrl:  pgtype.Text{String: "http://127.0.0.1:5201", Valid: true},
		GreenUpstreamUrl: pgtype.Text{String: "http://127.0.0.1:5202", Valid: true},
	}}}, NewLogBus(nil), nil, nil)
	remote := &fakeRemoteRunner{}

	err := runner.checkColorHealth(context.Background(), db.GetDeploymentTargetRow{
		Hostname:       "playground",
		Strategy:       "blue_green",
		HealthCheckUrl: pgtype.Text{String: "http://127.0.0.1:{port}/{color}/health", Valid: true},
	}, remote, "green")
	if err != nil {
		t.Fatal(err)
	}
	if len(remote.commands) != 1 || !strings.Contains(remote.commands[0], "http://host.docker.internal:5202/green/health") {
		t.Fatalf("expected playground health check to use the Docker host, got %+v", remote.commands)
	}
}

func TestApplyProxyRoutesRunsLinkedApplicationRoutes(t *testing.T) {
	applicationID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	serverID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	routeID := pgtype.UUID{Bytes: [16]byte{3}, Valid: true}
	deploymentID := pgtype.UUID{Bytes: [16]byte{4}, Valid: true}
	queries := &fakeRunnerQueries{
		proxyRoutes: []db.ListProxyRouteTargetsForApplicationRow{{
			ID:            routeID,
			ApplicationID: applicationID,
			ServerID:      serverID,
			Domain:        "app.example.com",
			UpstreamUrl:   "http://127.0.0.1:3000",
			TlsEnabled:    true,
			ProxyType:     "caddy",
		}},
	}
	remote := &fakeRemoteRunner{}
	runner := NewRunner(queries, NewLogBus(nil), nil, nil)

	err := runner.applyProxyRoutes(context.Background(), db.Deployment{ID: deploymentID}, db.GetDeploymentTargetRow{
		ApplicationID: applicationID,
		ServerID:      serverID,
		ProxyType:     "caddy",
	}, remote, "")
	if err != nil {
		t.Fatal(err)
	}

	if len(remote.commands) != 1 || !strings.Contains(remote.commands[0], "reverse_proxy http://127.0.0.1:3000") {
		t.Fatalf("expected caddy proxy command, got %+v", remote.commands)
	}
	if len(queries.appliedProxyRoutes) != 1 || queries.appliedProxyRoutes[0] != routeID {
		t.Fatalf("expected proxy route to be marked applied, got %+v", queries.appliedProxyRoutes)
	}
	if len(queries.failedProxyRoutes) != 0 {
		t.Fatalf("did not expect failed proxy route marks, got %+v", queries.failedProxyRoutes)
	}
}

func TestApplyProxyRoutesMarksRouteFailedWhenCommandFails(t *testing.T) {
	applicationID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	serverID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	routeID := pgtype.UUID{Bytes: [16]byte{3}, Valid: true}
	queries := &fakeRunnerQueries{
		proxyRoutes: []db.ListProxyRouteTargetsForApplicationRow{{
			ID:            routeID,
			ApplicationID: applicationID,
			ServerID:      serverID,
			Domain:        "app.example.com",
			UpstreamUrl:   "http://127.0.0.1:3000",
			TlsEnabled:    true,
			ProxyType:     "caddy",
		}},
	}
	remote := &fakeRemoteRunner{err: errors.New("reload failed")}
	runner := NewRunner(queries, NewLogBus(nil), nil, nil)

	err := runner.applyProxyRoutes(context.Background(), db.Deployment{}, db.GetDeploymentTargetRow{
		ApplicationID: applicationID,
		ServerID:      serverID,
		ProxyType:     "caddy",
	}, remote, "")
	if err == nil {
		t.Fatal("expected proxy command failure")
	}
	if len(queries.failedProxyRoutes) != 1 || queries.failedProxyRoutes[0] != routeID {
		t.Fatalf("expected proxy route to be marked failed, got %+v", queries.failedProxyRoutes)
	}
}

func TestApplyProxyRoutesUsesColorSpecificUpstream(t *testing.T) {
	applicationID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	serverID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	routeID := pgtype.UUID{Bytes: [16]byte{3}, Valid: true}
	queries := &fakeRunnerQueries{
		proxyRoutes: []db.ListProxyRouteTargetsForApplicationRow{{
			ID:               routeID,
			ApplicationID:    applicationID,
			ServerID:         serverID,
			Domain:           "app.example.com",
			UpstreamUrl:      "http://127.0.0.1:3000",
			BlueUpstreamUrl:  pgtype.Text{String: "http://127.0.0.1:3101", Valid: true},
			GreenUpstreamUrl: pgtype.Text{String: "http://127.0.0.1:3102", Valid: true},
			TlsEnabled:       true,
			ProxyType:        "caddy",
		}},
	}
	remote := &fakeRemoteRunner{}
	runner := NewRunner(queries, NewLogBus(nil), nil, nil)

	err := runner.applyProxyRoutes(context.Background(), db.Deployment{}, db.GetDeploymentTargetRow{
		ApplicationID: applicationID,
		ServerID:      serverID,
		ProxyType:     "caddy",
	}, remote, "green")
	if err != nil {
		t.Fatal(err)
	}

	if len(queries.updatedProxyUpstreams) != 1 || queries.updatedProxyUpstreams[0] != "http://127.0.0.1:3102" {
		t.Fatalf("expected green upstream update, got %+v", queries.updatedProxyUpstreams)
	}
	if len(remote.commands) != 1 || !strings.Contains(remote.commands[0], "reverse_proxy http://127.0.0.1:3102") {
		t.Fatalf("expected caddy proxy command to use green upstream, got %+v", remote.commands)
	}
}

func TestApplyProxyRoutesRollsBackEveryRouteWhenDatabasePromotionFails(t *testing.T) {
	applicationID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	serverID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	queries := &fakeRunnerQueries{
		promoteProxyRoutesErr: errors.New("database unavailable"),
		proxyRoutes: []db.ListProxyRouteTargetsForApplicationRow{
			{
				ID:               pgtype.UUID{Bytes: [16]byte{3}, Valid: true},
				ApplicationID:    applicationID,
				ServerID:         serverID,
				Domain:           "web.example.com",
				UpstreamUrl:      "http://127.0.0.1:3101",
				GreenUpstreamUrl: pgtype.Text{String: "http://127.0.0.1:3102", Valid: true},
				TlsEnabled:       true,
				ProxyType:        "caddy",
			},
			{
				ID:               pgtype.UUID{Bytes: [16]byte{4}, Valid: true},
				ApplicationID:    applicationID,
				ServerID:         serverID,
				Domain:           "api.example.com",
				UpstreamUrl:      "http://127.0.0.1:3201",
				GreenUpstreamUrl: pgtype.Text{String: "http://127.0.0.1:3202", Valid: true},
				TlsEnabled:       true,
				ProxyType:        "caddy",
			},
		},
	}
	remote := &fakeRemoteRunner{}
	runner := NewRunner(queries, NewLogBus(nil), nil, nil)

	err := runner.applyProxyRoutes(context.Background(), db.Deployment{}, db.GetDeploymentTargetRow{
		ApplicationID: applicationID,
		ServerID:      serverID,
		ProxyType:     "caddy",
	}, remote, "green")
	if err == nil || !strings.Contains(err.Error(), "record promoted proxy routes") {
		t.Fatalf("expected atomic promotion failure, got %v", err)
	}
	if len(remote.commands) != 4 {
		t.Fatalf("expected two route updates and two reverse-order rollbacks, got %d", len(remote.commands))
	}
	if !strings.Contains(remote.commands[2], "http://127.0.0.1:3201") || !strings.Contains(remote.commands[3], "http://127.0.0.1:3101") {
		t.Fatalf("expected both original routes to be restored in reverse order")
	}
}

type fakeRunnerQueries struct {
	startErr                error
	startAttempts           int
	startDeployment         db.Deployment
	targetLoads             int
	deploymentStatusErr     error
	deploymentStatuses      []string
	applicationStatuses     []db.UpdateApplicationStatusParams
	logs                    []db.AppendDeploymentLogParams
	auditEvents             []db.AppendAuditEventParams
	target                  db.GetDeploymentTargetRow
	proxyRoutes             []db.ListProxyRouteTargetsForApplicationRow
	appliedProxyRoutes      []pgtype.UUID
	failedProxyRoutes       []pgtype.UUID
	updatedProxyUpstreams   []string
	promoteProxyRoutesErr   error
	deploymentCommit        string
	deploymentCommitMessage string
	projectRuntimeVariables []db.ProjectRuntimeVariable
	serviceRuntimeConfigs   []db.ApplicationServiceRuntimeConfig
	deployedConfigurations  []db.MarkApplicationConfigurationDeployedParams
}

func (q *fakeRunnerQueries) AppendAuditEvent(_ context.Context, params db.AppendAuditEventParams) (db.AuditEvent, error) {
	q.auditEvents = append(q.auditEvents, params)
	return db.AuditEvent{}, nil
}

func (q *fakeRunnerQueries) AppendDeploymentLog(_ context.Context, params db.AppendDeploymentLogParams) (db.DeploymentLog, error) {
	q.logs = append(q.logs, params)
	return db.DeploymentLog{
		DeploymentID: params.DeploymentID,
		Stream:       params.Stream,
		Message:      params.Message,
	}, nil
}

func (q *fakeRunnerQueries) ActivateDeploymentSlot(context.Context, db.ActivateDeploymentSlotParams) ([]db.ApplicationDeploymentSlot, error) {
	return nil, nil
}

func (q *fakeRunnerQueries) GetDeploymentTarget(context.Context, pgtype.UUID) (db.GetDeploymentTargetRow, error) {
	q.targetLoads++
	return q.target, nil
}

func (q *fakeRunnerQueries) GetActiveDeploymentSlot(context.Context, db.GetActiveDeploymentSlotParams) (db.ApplicationDeploymentSlot, error) {
	return db.ApplicationDeploymentSlot{}, pgx.ErrNoRows
}

func (q *fakeRunnerQueries) GetStandbyDeploymentSlot(context.Context, db.GetStandbyDeploymentSlotParams) (db.ApplicationDeploymentSlot, error) {
	return db.ApplicationDeploymentSlot{}, pgx.ErrNoRows
}

func (q *fakeRunnerQueries) ListApplicationServiceRuntimeConfigs(context.Context, pgtype.UUID) ([]db.ApplicationServiceRuntimeConfig, error) {
	return q.serviceRuntimeConfigs, nil
}

func (q *fakeRunnerQueries) ListProjectRuntimeVariablesForApplication(context.Context, pgtype.UUID) ([]db.ProjectRuntimeVariable, error) {
	return q.projectRuntimeVariables, nil
}

func (q *fakeRunnerQueries) ListProxyRouteTargetsForApplication(context.Context, db.ListProxyRouteTargetsForApplicationParams) ([]db.ListProxyRouteTargetsForApplicationRow, error) {
	return q.proxyRoutes, nil
}

func (q *fakeRunnerQueries) MarkProxyRouteApplied(_ context.Context, id pgtype.UUID) (db.ProxyRoute, error) {
	q.appliedProxyRoutes = append(q.appliedProxyRoutes, id)
	return db.ProxyRoute{ID: id, Status: "applied"}, nil
}

func (q *fakeRunnerQueries) MarkApplicationConfigurationDeployed(_ context.Context, params db.MarkApplicationConfigurationDeployedParams) (db.Application, error) {
	q.deployedConfigurations = append(q.deployedConfigurations, params)
	return db.Application{}, nil
}

func (q *fakeRunnerQueries) MarkProxyRouteFailed(_ context.Context, id pgtype.UUID) (db.ProxyRoute, error) {
	q.failedProxyRoutes = append(q.failedProxyRoutes, id)
	return db.ProxyRoute{ID: id, Status: "failed"}, nil
}

func (q *fakeRunnerQueries) PromoteProxyRoutes(_ context.Context, params db.PromoteProxyRoutesParams) ([]db.ProxyRoute, error) {
	if q.promoteProxyRoutesErr != nil {
		return nil, q.promoteProxyRoutesErr
	}
	routes := make([]db.ProxyRoute, 0, len(params.RouteIds))
	for index, id := range params.RouteIds {
		q.appliedProxyRoutes = append(q.appliedProxyRoutes, id)
		q.updatedProxyUpstreams = append(q.updatedProxyUpstreams, params.UpstreamUrls[index])
		routes = append(routes, db.ProxyRoute{ID: id, UpstreamUrl: params.UpstreamUrls[index], Status: "applied"})
	}
	return routes, nil
}

func (q *fakeRunnerQueries) StartQueuedDeployment(_ context.Context, id pgtype.UUID) (db.Deployment, error) {
	q.startAttempts++
	if q.startErr != nil {
		return db.Deployment{}, q.startErr
	}
	if q.startDeployment.ID.Valid {
		return q.startDeployment, nil
	}
	return db.Deployment{ID: id, Status: "running"}, nil
}

func (q *fakeRunnerQueries) SetDeploymentCommitSHA(_ context.Context, params db.SetDeploymentCommitSHAParams) (db.Deployment, error) {
	q.deploymentCommit = params.CommitSha
	q.deploymentCommitMessage = params.CommitMessage
	return db.Deployment{
		ID:            params.DeploymentID,
		CommitSha:     pgtype.Text{String: params.CommitSha, Valid: true},
		CommitMessage: pgtype.Text{String: params.CommitMessage, Valid: params.CommitMessage != ""},
	}, nil
}

func (q *fakeRunnerQueries) UpdateApplicationStatus(_ context.Context, params db.UpdateApplicationStatusParams) (db.Application, error) {
	q.applicationStatuses = append(q.applicationStatuses, params)
	return db.Application{}, nil
}

func (q *fakeRunnerQueries) UpdateDeploymentStatus(_ context.Context, params db.UpdateDeploymentStatusParams) (db.Deployment, error) {
	q.deploymentStatuses = append(q.deploymentStatuses, params.Status)
	if q.deploymentStatusErr != nil {
		return db.Deployment{}, q.deploymentStatusErr
	}
	return db.Deployment{ID: params.ID, Status: params.Status}, nil
}

func (q *fakeRunnerQueries) UpsertDeploymentSlot(context.Context, db.UpsertDeploymentSlotParams) (db.ApplicationDeploymentSlot, error) {
	return db.ApplicationDeploymentSlot{}, nil
}

type fakeRemoteRunner struct {
	commands []string
	output   string
	err      error
}

type fakeRuntimeVariableSource struct {
	variables []connectors.RuntimeVariable
	err       error
}

type scopedRuntimeVariableSource struct {
	variables map[string][]connectors.RuntimeVariable
	scopes    []connectors.RuntimeVariableScope
}

func (source fakeRuntimeVariableSource) RuntimeVariables(context.Context, connectors.RuntimeVariableScope) ([]connectors.RuntimeVariable, error) {
	return source.variables, source.err
}

func (source *scopedRuntimeVariableSource) RuntimeVariables(_ context.Context, scope connectors.RuntimeVariableScope) ([]connectors.RuntimeVariable, error) {
	source.scopes = append(source.scopes, scope)
	return source.variables[scope.Project+"/"+scope.Config], nil
}

func (r *fakeRemoteRunner) Run(_ context.Context, command string) (string, error) {
	r.commands = append(r.commands, command)
	return r.output, r.err
}

func containsLog(logs []db.AppendDeploymentLogParams, value string) bool {
	for _, log := range logs {
		if strings.Contains(log.Message, value) {
			return true
		}
	}
	return false
}

func containsAudit(events []db.AppendAuditEventParams, action string) bool {
	for _, event := range events {
		if event.Action == action {
			return true
		}
	}
	return false
}
