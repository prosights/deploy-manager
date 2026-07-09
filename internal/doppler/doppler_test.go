package doppler

import (
	"context"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"

	"deploy-manager/internal/connectors"
)

func TestIssueRuntimeInjectionMintsShortLivedServiceToken(t *testing.T) {
	var gotToken string
	var gotArgs []string
	connector := Connector{
		project: "billing",
		config:  "prd",
		token:   "token-123",
		run: func(_ context.Context, token string, args []string) ([]byte, error) {
			gotToken = token
			gotArgs = args
			return []byte("dp.st.prd.abc123\n"), nil
		},
	}

	injection, err := connector.IssueRuntimeInjection(context.Background(), connectors.RuntimeVariableScope{}, "deploy-manager-1234-99")
	if err != nil {
		t.Fatal(err)
	}

	if gotToken != "token-123" {
		t.Fatalf("expected connector token to be forwarded, got %q", gotToken)
	}
	expectedArgs := []string{
		"doppler", "configs", "tokens", "create", "deploy-manager-1234-99",
		"--project", "billing",
		"--config", "prd",
		"--max-age", deploymentTokenMaxAge,
		"--plain",
	}
	if !reflect.DeepEqual(gotArgs, expectedArgs) {
		t.Fatalf("expected args %+v, got %+v", expectedArgs, gotArgs)
	}
	if injection.Project != "billing" || injection.Config != "prd" || injection.Token != "dp.st.prd.abc123" {
		t.Fatalf("unexpected runtime injection: %+v", injection)
	}
}

func TestIssueRuntimeInjectionPrefersScopeOverConfiguredDefaults(t *testing.T) {
	var gotArgs []string
	connector := Connector{
		project: "default-project",
		config:  "default-config",
		run: func(_ context.Context, _ string, args []string) ([]byte, error) {
			gotArgs = args
			return []byte("dp.st.prd.abc"), nil
		},
	}

	injection, err := connector.IssueRuntimeInjection(context.Background(), connectors.RuntimeVariableScope{
		Project: "api",
		Config:  "stg",
	}, "deploy-manager-1")
	if err != nil {
		t.Fatal(err)
	}
	if injection.Project != "api" || injection.Config != "stg" {
		t.Fatalf("expected scope to win over defaults, got %+v", injection)
	}
	joined := strings.Join(gotArgs, " ")
	if !strings.Contains(joined, "--project api") || !strings.Contains(joined, "--config stg") {
		t.Fatalf("expected scoped project/config args, got %+v", gotArgs)
	}
}

func TestIssueRuntimeInjectionRequiresProjectAndConfig(t *testing.T) {
	for name, scope := range map[string]connectors.RuntimeVariableScope{
		"empty":          {},
		"missing config": {Project: "api"},
		"missing proj":   {Config: "prd"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := New("", "", "").IssueRuntimeInjection(context.Background(), scope, "deploy-manager-1")
			if err == nil {
				t.Fatal("expected missing doppler scope to fail")
			}
		})
	}
}

func TestIssueRuntimeInjectionRejectsInvalidTokenNames(t *testing.T) {
	for _, name := range []string{"", "has space", "bad$name", strings.Repeat("x", 65)} {
		_, err := New("billing", "prd", "").IssueRuntimeInjection(context.Background(), connectors.RuntimeVariableScope{}, name)
		if err == nil {
			t.Fatalf("expected token name %q to fail", name)
		}
	}
}

func TestIssueRuntimeInjectionRejectsInvalidCLIOutput(t *testing.T) {
	for name, output := range map[string]string{
		"empty":      "",
		"whitespace": "   \n",
		"multi-word": "unexpected error text",
	} {
		t.Run(name, func(t *testing.T) {
			connector := Connector{
				project: "billing",
				config:  "prd",
				run: func(context.Context, string, []string) ([]byte, error) {
					return []byte(output), nil
				},
			}
			_, err := connector.IssueRuntimeInjection(context.Background(), connectors.RuntimeVariableScope{}, "deploy-manager-1")
			if err == nil {
				t.Fatal("expected invalid CLI output to fail")
			}
		})
	}
}

func TestIssueRuntimeInjectionWrapsCLIFailures(t *testing.T) {
	connector := Connector{
		project: "billing",
		config:  "prd",
		run: func(context.Context, string, []string) ([]byte, error) {
			return nil, errors.New("permission denied")
		},
	}
	_, err := connector.IssueRuntimeInjection(context.Background(), connectors.RuntimeVariableScope{}, "deploy-manager-1")
	if err == nil || !strings.Contains(err.Error(), "billing/prd") {
		t.Fatalf("expected scoped CLI failure, got %v", err)
	}
}

func TestIssueRuntimeInjectionUsesConfiguredCommandPath(t *testing.T) {
	var gotArgs []string
	connector := Connector{
		project: "billing",
		config:  "prd",
		command: "/usr/local/bin/doppler",
		run: func(_ context.Context, _ string, args []string) ([]byte, error) {
			gotArgs = args
			return []byte("dp.st.prd.abc"), nil
		},
	}

	if _, err := connector.IssueRuntimeInjection(context.Background(), connectors.RuntimeVariableScope{}, "deploy-manager-1"); err != nil {
		t.Fatal(err)
	}
	if gotArgs[0] != "/usr/local/bin/doppler" {
		t.Fatalf("expected configured command path, got %+v", gotArgs)
	}
}

func TestSyncCredentialsReportsRuntimeScopeInventory(t *testing.T) {
	inventory, err := New("", "", "").SyncCredentials(context.Background(), connectors.SyncScope{
		Name: "production doppler",
		Config: []byte(`{
			"project": " billing ",
			"config": " prd ",
			"applications": [" api ", "worker", "api", " "]
		}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(inventory) != 1 {
		t.Fatalf("expected one credential inventory item, got %+v", inventory)
	}

	item := inventory[0]
	if item.Provider != "doppler" || item.ExternalRef != "doppler://billing/prd" || item.Type != "runtime_scope" {
		t.Fatalf("unexpected Doppler inventory identity: %+v", item)
	}
	if len(item.Permissions) != 1 || item.Permissions[0].Permission != "service_tokens:create" {
		t.Fatalf("expected Doppler service token permission, got %+v", item.Permissions)
	}
	if len(item.Usages) != 2 {
		t.Fatalf("expected deduplicated application usages, got %+v", item.Usages)
	}
	if item.Usages[0].UsedByName != "api" || item.Usages[1].UsedByName != "worker" {
		t.Fatalf("unexpected Doppler usages: %+v", item.Usages)
	}
}

func TestSyncCredentialsUsesConfiguredDefaults(t *testing.T) {
	inventory, err := New("billing", "prd", "").SyncCredentials(context.Background(), connectors.SyncScope{Name: "global doppler"})
	if err != nil {
		t.Fatal(err)
	}
	if inventory[0].ExternalRef != "doppler://billing/prd" {
		t.Fatalf("expected default Doppler scope, got %+v", inventory[0])
	}
	if len(inventory[0].Usages) != 1 || inventory[0].Usages[0].UsedByType != "connector" {
		t.Fatalf("expected connector fallback usage, got %+v", inventory[0].Usages)
	}
}

func TestSyncCredentialsRequiresProjectAndConfig(t *testing.T) {
	_, err := New("", "", "").SyncCredentials(context.Background(), connectors.SyncScope{
		Name:   "broken",
		Config: []byte(`{"project":"billing"}`),
	})
	if err == nil {
		t.Fatal("expected missing Doppler config to fail")
	}
}

func TestCheckFindsConfiguredCommandPath(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}

	if err := NewWithCommand("", "", "", executable).Check(); err != nil {
		t.Fatal(err)
	}
}
