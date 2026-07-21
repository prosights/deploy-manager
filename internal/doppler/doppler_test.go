package doppler

import (
	"context"
	"os"
	"reflect"
	"testing"

	"deploy-manager/internal/connectors"
)

func TestPublicPrefixDetection(t *testing.T) {
	cases := map[string]bool{
		"NEXT_PUBLIC_API_URL": true,
		"PUBLIC_SITE_NAME":    true,
		"VITE_PUBLIC_FLAG":    true,
		"DATABASE_URL":        false,
	}

	for key, expected := range cases {
		if hasPublicPrefix(key) != expected {
			t.Fatalf("expected %s public=%v", key, expected)
		}
	}
}

func TestRuntimeVariablesNoopsWithoutScope(t *testing.T) {
	variables, err := New("", "", "").RuntimeVariables(context.Background(), connectors.RuntimeVariableScope{})
	if err != nil {
		t.Fatal(err)
	}
	if len(variables) != 0 {
		t.Fatalf("expected no variables, got %d", len(variables))
	}
}

func TestRuntimeVariablesRequiresProjectAndConfigPair(t *testing.T) {
	_, err := New("", "", "").RuntimeVariables(context.Background(), connectors.RuntimeVariableScope{Project: "api"})
	if err == nil {
		t.Fatal("expected missing config to fail")
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
	if len(item.Permissions) != 1 || item.Permissions[0].Permission != "secrets:download" {
		t.Fatalf("expected Doppler download permission, got %+v", item.Permissions)
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

func TestRuntimeVariablesParsesDopplerOutput(t *testing.T) {
	var gotToken string
	var gotArgs []string
	connector := Connector{
		project: "billing",
		config:  "prd",
		token:   "token-123",
		run: func(_ context.Context, token string, args []string) ([]byte, error) {
			gotToken = token
			gotArgs = args
			return []byte(`{
				"DATABASE_URL": "postgres://db",
				"FEATURE_ENABLED": true,
				"PORT": 8080,
				"VITE_PUBLIC_API_URL": "https://api.example.com",
				"BAD-KEY": "ignored",
				"DOPPLER_PROJECT": "billing",
				"NESTED": {"ignored": true}
			}`), nil
		},
	}

	variables, err := connector.RuntimeVariables(context.Background(), connectors.RuntimeVariableScope{})
	if err != nil {
		t.Fatal(err)
	}

	if gotToken != "token-123" {
		t.Fatalf("expected token to be forwarded, got %q", gotToken)
	}
	expectedArgs := []string{"doppler", "secrets", "download", "--no-file", "--format", "json", "--project", "billing", "--config", "prd"}
	if !reflect.DeepEqual(gotArgs, expectedArgs) {
		t.Fatalf("expected args %+v, got %+v", expectedArgs, gotArgs)
	}

	values := map[string]connectors.RuntimeVariable{}
	for _, variable := range variables {
		values[variable.Key] = variable
	}
	if values["DATABASE_URL"].Value != "postgres://db" {
		t.Fatalf("expected DATABASE_URL, got %+v", values)
	}
	if values["FEATURE_ENABLED"].Value != "true" || values["PORT"].Value != "8080" {
		t.Fatalf("expected scalar conversion, got %+v", values)
	}
	if !values["VITE_PUBLIC_API_URL"].IsPublic {
		t.Fatalf("expected public variable flag, got %+v", values["VITE_PUBLIC_API_URL"])
	}
	if _, ok := values["DOPPLER_PROJECT"]; ok {
		t.Fatal("did not expect Doppler metadata variable")
	}
	if _, ok := values["BAD-KEY"]; ok {
		t.Fatal("did not expect invalid runtime key")
	}
	if _, ok := values["NESTED"]; ok {
		t.Fatal("did not expect nested variable")
	}
	keys := make([]string, 0, len(variables))
	for _, variable := range variables {
		keys = append(keys, variable.Key)
	}
	expectedKeys := []string{"DATABASE_URL", "FEATURE_ENABLED", "PORT", "VITE_PUBLIC_API_URL"}
	if !reflect.DeepEqual(keys, expectedKeys) {
		t.Fatalf("expected sorted keys %+v, got %+v", expectedKeys, keys)
	}
}

func TestRuntimeVariablesUsesConfiguredCommandPath(t *testing.T) {
	var gotArgs []string
	connector := Connector{
		project: "billing",
		config:  "prd",
		command: "/usr/local/bin/doppler",
		run: func(_ context.Context, _ string, args []string) ([]byte, error) {
			gotArgs = args
			return []byte(`{}`), nil
		},
	}

	if _, err := connector.RuntimeVariables(context.Background(), connectors.RuntimeVariableScope{}); err != nil {
		t.Fatal(err)
	}
	if gotArgs[0] != "/usr/local/bin/doppler" {
		t.Fatalf("expected configured command path, got %+v", gotArgs)
	}
}

func TestCatalogListsSortedProjectsAndConfigs(t *testing.T) {
	connector := Connector{
		token: "token-123",
		run: func(_ context.Context, token string, args []string) ([]byte, error) {
			if token != "token-123" {
				t.Fatalf("expected token to be forwarded, got %q", token)
			}
			switch args[1] {
			case "projects":
				return []byte(`[{"id":"zeta"},{"id":" billing "},{"id":"billing"}]`), nil
			case "configs":
				if !reflect.DeepEqual(args, []string{"doppler", "configs", "--json", "--no-check-version", "--project", "billing"}) {
					t.Fatalf("unexpected config args: %+v", args)
				}
				return []byte(`[{"name":"stg"},{"name":" prd "},{"name":"prd"}]`), nil
			default:
				t.Fatalf("unexpected Doppler command: %+v", args)
				return nil, nil
			}
		},
	}

	projects, err := connector.ListProjects(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	configs, err := connector.ListConfigs(context.Background(), " billing ")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(projects, []string{"billing", "zeta"}) || !reflect.DeepEqual(configs, []string{"prd", "stg"}) {
		t.Fatalf("unexpected catalog: projects=%+v configs=%+v", projects, configs)
	}
}

func TestCheckFindsConfiguredCommandPath(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}

	if err := NewWithCommand("", "", "token-123", executable).Check(); err != nil {
		t.Fatal(err)
	}
}

func TestCheckRequiresToken(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}

	if err := NewWithCommand("", "", "", executable).Check(); err == nil {
		t.Fatal("expected missing token to fail")
	}
}
