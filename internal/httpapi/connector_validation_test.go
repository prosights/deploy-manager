package httpapi

import (
	"encoding/json"
	"testing"

	"deploy-manager/internal/db"
)

func TestNormalizeConnectorAccountAllowsMetadataOnlyConfig(t *testing.T) {
	input := db.UpsertConnectorAccountParams{
		Provider: " GitHub ",
		Name:     " production ",
		Enabled:  true,
		Config:   []byte(`{"default_branch":"main","labels":["deploy"],"webhook_url":"/api/webhooks/github","repositories":[{"repository":"prosights/api","branch":"main"}]}`),
	}

	normalized, err := normalizeConnectorAccount(input)
	if err != nil {
		t.Fatal(err)
	}

	if normalized.Provider != "github" || normalized.Name != "production" {
		t.Fatalf("expected trimmed connector identity, got %+v", normalized)
	}

	var config map[string]any
	if err := json.Unmarshal(normalized.Config, &config); err != nil {
		t.Fatal(err)
	}
	if config["default_branch"] != "main" || config["webhook_url"] != "/api/webhooks/github" {
		t.Fatalf("unexpected normalized config: %+v", config)
	}
}

func TestNormalizeConnectorAccountRejectsInvalidGitHubRepositoryConfig(t *testing.T) {
	_, err := normalizeConnectorAccount(db.UpsertConnectorAccountParams{
		Provider: "github",
		Name:     "production",
		Config:   []byte(`{"repositories":[{"repository":"https://github.com/prosights/api"}]}`),
	})
	if err == nil {
		t.Fatal("expected invalid github repository config to fail")
	}
}

func TestNormalizeConnectorAccountRequiresDopplerProjectAndConfig(t *testing.T) {
	for _, config := range []string{
		`{}`,
		`{"project":"internal"}`,
		`{"config":"prd"}`,
	} {
		t.Run(config, func(t *testing.T) {
			_, err := normalizeConnectorAccount(db.UpsertConnectorAccountParams{
				Provider: "doppler",
				Name:     "runtime",
				Config:   []byte(config),
			})
			if err == nil {
				t.Fatal("expected incomplete doppler config to fail")
			}
		})
	}
}

func TestNormalizeConnectorAccountAcceptsDopplerProjectAndConfig(t *testing.T) {
	normalized, err := normalizeConnectorAccount(db.UpsertConnectorAccountParams{
		Provider: "doppler",
		Name:     "runtime",
		Config:   []byte(`{"project":" internal ","config":" prd "}`),
	})
	if err != nil {
		t.Fatal(err)
	}

	var config map[string]any
	if err := json.Unmarshal(normalized.Config, &config); err != nil {
		t.Fatal(err)
	}
	if config["project"] != "internal" || config["config"] != "prd" {
		t.Fatalf("unexpected doppler config: %+v", config)
	}
}

func TestUpsertConnectorRequestAcceptsObjectConfig(t *testing.T) {
	var request upsertConnectorRequest
	if err := json.Unmarshal([]byte(`{"provider":"s3","name":"production","enabled":true,"config":{"region":"us-east-1"}}`), &request); err != nil {
		t.Fatal(err)
	}

	normalized, err := normalizeConnectorAccount(db.UpsertConnectorAccountParams{
		Provider: request.Provider,
		Name:     request.Name,
		Enabled:  request.Enabled,
		Config:   []byte(request.Config),
	})
	if err != nil {
		t.Fatal(err)
	}

	var config map[string]any
	if err := json.Unmarshal(normalized.Config, &config); err != nil {
		t.Fatal(err)
	}
	if config["region"] != "us-east-1" {
		t.Fatalf("unexpected connector config: %+v", config)
	}
}

func TestNormalizeConnectorAccountDefaultsBlankConfig(t *testing.T) {
	normalized, err := normalizeConnectorAccount(db.UpsertConnectorAccountParams{
		Provider: "slack",
		Name:     "notifications",
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(normalized.Config) != "{}" {
		t.Fatalf("expected default empty config, got %s", normalized.Config)
	}
}

func TestNormalizeConnectorAccountPrunesBlankMetadata(t *testing.T) {
	normalized, err := normalizeConnectorAccount(db.UpsertConnectorAccountParams{
		Provider: "s3",
		Name:     "production",
		Config:   []byte(`{"region":" us-east-1 ","empty":"","unused":null,"buckets":[{"bucket":" assets ","prefix":" "},null," "]}`),
	})
	if err != nil {
		t.Fatal(err)
	}

	var config map[string]any
	if err := json.Unmarshal(normalized.Config, &config); err != nil {
		t.Fatal(err)
	}
	if config["region"] != "us-east-1" {
		t.Fatalf("expected trimmed region, got %+v", config)
	}
	if _, ok := config["empty"]; ok {
		t.Fatalf("expected blank string to be pruned, got %+v", config)
	}
	if _, ok := config["unused"]; ok {
		t.Fatalf("expected null to be pruned, got %+v", config)
	}
	buckets := config["buckets"].([]any)
	bucket := buckets[0].(map[string]any)
	if len(buckets) != 1 || bucket["bucket"] != "assets" {
		t.Fatalf("expected pruned bucket metadata, got %+v", config)
	}
}

func TestNormalizeConnectorAccountRejectsBlankSecretLikeConfigKeys(t *testing.T) {
	_, err := normalizeConnectorAccount(db.UpsertConnectorAccountParams{
		Provider: "github",
		Name:     "production",
		Config:   []byte(`{"api_key":" "}`),
	})
	if err == nil {
		t.Fatal("expected blank secret-like connector config key to fail")
	}
}

func TestNormalizeConnectorAccountRejectsUnsupportedProvider(t *testing.T) {
	_, err := normalizeConnectorAccount(db.UpsertConnectorAccountParams{
		Provider: "vault",
		Name:     "production",
		Config:   []byte(`{}`),
	})
	if err == nil {
		t.Fatal("expected unsupported connector provider to fail")
	}
}

func TestNormalizeConnectorAccountRejectsControlCharactersInName(t *testing.T) {
	_, err := normalizeConnectorAccount(db.UpsertConnectorAccountParams{
		Provider: "github",
		Name:     "production\nrepo",
		Config:   []byte(`{}`),
	})
	if err == nil {
		t.Fatal("expected connector name with control characters to fail")
	}
}

func TestNormalizeConnectorAccountRejectsSecretLikeConfigKeys(t *testing.T) {
	for _, config := range []string{
		`{"api_key":"value"}`,
		`{"apiToken":"value"}`,
		`{"oauth":{"client_secret":"value"}}`,
		`{"accounts":[{"token":"value"}]}`,
		`{"privateKey":"value"}`,
		`{"buckets":[{"accessKeyId":"value"}]}`,
	} {
		t.Run(config, func(t *testing.T) {
			_, err := normalizeConnectorAccount(db.UpsertConnectorAccountParams{
				Provider: "github",
				Name:     "production",
				Config:   []byte(config),
			})
			if err == nil {
				t.Fatal("expected secret-like connector config key to fail")
			}
		})
	}
}

func TestNormalizeConnectorAccountRejectsSecretLikeConfigValues(t *testing.T) {
	for _, config := range []string{
		`{"reference":"ghp_1234567890"}`,
		`{"webhook":{"value":"xoxb-1234567890"}}`,
		`{"certificate":"-----BEGIN PRIVATE KEY-----"}`,
		`{"service_account":"{\"private_key_id\":\"abc123\",\"client_email\":\"deploy@example.com\"}"}`,
	} {
		t.Run(config, func(t *testing.T) {
			_, err := normalizeConnectorAccount(db.UpsertConnectorAccountParams{
				Provider: "github",
				Name:     "production",
				Config:   []byte(config),
			})
			if err == nil {
				t.Fatal("expected secret-like connector config value to fail")
			}
		})
	}
}

func TestNormalizeConnectorAccountRejectsNonObjectConfig(t *testing.T) {
	_, err := normalizeConnectorAccount(db.UpsertConnectorAccountParams{
		Provider: "github",
		Name:     "production",
		Config:   []byte(`["main"]`),
	})
	if err == nil {
		t.Fatal("expected non-object connector config to fail")
	}
}
