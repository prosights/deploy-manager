package main

import (
	"os"
	"strings"
	"testing"
)

func TestContainerSSHKnownHostsPathIsMounted(t *testing.T) {
	dockerfile := mustReadText(t, "Dockerfile")
	for _, expected := range []string{
		"https://packages.doppler.com/public/cli/alpine/any-version/main",
		"apk add --no-cache doppler",
		"ENV DOPPLER_CLI_PATH=doppler",
		"ENV DOPPLER_CONFIG_DIR=/tmp/.doppler",
		"ENV SSH_KNOWN_HOSTS_PATH=/app/known_hosts",
		"USER deploy",
	} {
		if !strings.Contains(dockerfile, expected) {
			t.Fatalf("expected Dockerfile to contain %q", expected)
		}
	}

	for _, composeFile := range []string{"docker-compose.yml", "docker-compose.dev.yml"} {
		compose := mustReadText(t, composeFile)
		for _, expected := range []string{
			"DOPPLER_CLI_PATH: \"${DOPPLER_CLI_PATH:-doppler}\"",
			"SSH_KNOWN_HOSTS_PATH: /app/known_hosts",
			"http://127.0.0.1:8080/api/readyz",
		} {
			if !strings.Contains(compose, expected) {
				t.Fatalf("expected %s to contain %q", composeFile, expected)
			}
		}
		if strings.Contains(compose, "SSH_KNOWN_HOSTS_FILE") {
			t.Fatalf("did not expect %s to require a host known_hosts bind mount by default", composeFile)
		}
	}
}

// Runtime env is injected exclusively through Doppler at deploy time. No
// compose file in this repository may read env files or mount a host .env:
// deployment targets never carry env files.
func TestComposeFilesNeverUseEnvFiles(t *testing.T) {
	for _, composeFile := range []string{
		"docker-compose.yml",
		"docker-compose.dev.yml",
		"docker-compose.deploy.yml",
		"ops/self-deploy/docker-compose.yml",
		"ops/self-deploy/stateful-compose.yml",
	} {
		compose := mustReadText(t, composeFile)
		if strings.Contains(compose, "env_file") {
			t.Fatalf("%s must not use env_file; runtime env is injected through doppler run", composeFile)
		}
		if strings.Contains(compose, "control/.env") {
			t.Fatalf("%s must not reference a host env file", composeFile)
		}
	}
}

func TestConnectorUpsertClearsStaleSyncStateOnConfigChange(t *testing.T) {
	query := mustReadText(t, "db/queries/core.sql")
	for _, expected := range []string{
		"last_sync_status = CASE",
		"connector_accounts.enabled IS DISTINCT FROM excluded.enabled",
		"connector_accounts.config IS DISTINCT FROM excluded.config",
		"last_sync_message = CASE",
		"last_synced_at = CASE",
	} {
		if !strings.Contains(query, expected) {
			t.Fatalf("expected connector upsert query to contain %q", expected)
		}
	}
}

func TestInterruptedDeploymentRecoveryMarksApplicationsFailed(t *testing.T) {
	query := mustReadText(t, "db/queries/core.sql")
	for _, expected := range []string{
		"WITH failed_deployments AS",
		"UPDATE applications",
		"SET status = 'failed'",
		"WHERE id IN (SELECT application_id FROM failed_deployments)",
		"FROM failed_deployments",
	} {
		if !strings.Contains(query, expected) {
			t.Fatalf("expected interrupted deployment recovery query to contain %q", expected)
		}
	}
}

func mustReadText(t *testing.T, path string) string {
	t.Helper()

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(content)
}
