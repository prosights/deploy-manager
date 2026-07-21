package db

import (
	"strings"
	"testing"
)

func TestCompleteBuildRunDoesNotRepeatSuccessfulCompletion(t *testing.T) {
	if !strings.Contains(completeBuildRun, "AND status <> 'succeeded'") {
		t.Fatal("successful build completion must be idempotent")
	}
}

func TestProjectVariableReplacementLocksRevisionRow(t *testing.T) {
	if !strings.Contains(getProjectForUpdate, "FOR UPDATE") {
		t.Fatal("project variable replacement must lock the project revision row")
	}
}

func TestConfigurationRedeploySourcePrefersActiveThenLatestSuccessful(t *testing.T) {
	for name, query := range map[string]string{
		"application": getApplicationConfigurationRedeployCandidate,
		"project":     listProjectConfigurationRedeployCandidates,
	} {
		t.Run(name, func(t *testing.T) {
			if !strings.Contains(query, "deployment.status = 'succeeded'") {
				t.Fatal("configuration redeploy source must come from a successful deployment")
			}
			if !strings.Contains(query, "ORDER BY (slot.id IS NOT NULL) DESC") || !strings.Contains(query, "deployment.created_at DESC") {
				t.Fatal("configuration redeploy must prefer the active slot and fall back to the latest successful deployment")
			}
		})
	}
}

func TestConfigurationRedeployLocksApplicationAndSnapshotsSource(t *testing.T) {
	if !strings.Contains(getApplicationForUpdate, "FOR UPDATE") {
		t.Fatal("configuration redeploy creation must serialize on the application row")
	}
	if !strings.Contains(createDeployment, "applications.repository_url") || !strings.Contains(createDeployment, "applications.branch") {
		t.Fatal("deployment creation must snapshot the configured repository and branch")
	}
	if !strings.Contains(createDeployment, "'configuration_state', application_configuration_state(applications.id)") {
		t.Fatal("deployment creation must snapshot the exact non-secret service configuration")
	}
	if !strings.Contains(getDeploymentTarget, "d.source_repository_url AS repository_url") || !strings.Contains(getDeploymentTarget, "COALESCE(d.source_branch, a.branch) AS branch") {
		t.Fatal("deployment execution must use its repository and branch snapshot")
	}
}

func TestConfigurationRedeployUsesExactSnapshotWhenAvailable(t *testing.T) {
	for name, query := range map[string]string{
		"applications": listApplications,
		"application redeploy": getApplicationConfigurationRedeployCandidate,
		"project redeploy": listProjectConfigurationRedeployCandidates,
	} {
		t.Run(name, func(t *testing.T) {
			if !strings.Contains(query, "application_configuration_state") || !strings.Contains(query, "configuration_snapshot->'configuration_state'") {
				t.Fatal("redeploy state must compare the current configuration with the deployed snapshot")
			}
		})
	}
}

func TestDeleteEnvironmentRequiresNoApplications(t *testing.T) {
	if !strings.Contains(deleteEnvironment, "NOT EXISTS") || !strings.Contains(deleteEnvironment, "applications.environment_id = environments.id") {
		t.Fatal("environment deletion must atomically reject environments that still contain services")
	}
}

func TestApplicationDeletionStateFindsRemoteAndActiveWork(t *testing.T) {
	if !strings.Contains(getApplicationDeletionState, "EXISTS") || !strings.Contains(getApplicationDeletionState, "status IN ('queued', 'running')") {
		t.Fatal("application deletion must detect deployed and in-progress services")
	}
}
