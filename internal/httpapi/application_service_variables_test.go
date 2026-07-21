package httpapi

import (
	"testing"

	"deploy-manager/internal/db"
)

func TestNormalizeApplicationServiceRuntimeConfigAllowsNonSecretOverrides(t *testing.T) {
	request, err := normalizeApplicationServiceRuntimeConfig(applicationServiceRuntimeConfigRequest{
		DopplerProject: " alleyes-web ",
		DopplerConfig:  " prd ",
		Variables: []projectRuntimeVariableInput{
			{Key: "PUBLIC_API_URL", Value: "https://api.example.com"},
			{Key: "APP_ENV", Value: "production"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if request.DopplerProject != "alleyes-web" || request.DopplerConfig != "prd" {
		t.Fatalf("expected trimmed Doppler scope, got %+v", request)
	}
	if request.Variables[0].Key != "APP_ENV" || request.Variables[1].Key != "PUBLIC_API_URL" {
		t.Fatalf("expected stable variable ordering, got %+v", request.Variables)
	}
}

func TestNormalizeApplicationServiceRuntimeConfigRejectsRawSecrets(t *testing.T) {
	_, err := normalizeApplicationServiceRuntimeConfig(applicationServiceRuntimeConfigRequest{
		Variables: []projectRuntimeVariableInput{{Key: "API_TOKEN", Value: "raw-secret"}},
	})
	if err == nil {
		t.Fatal("expected secret-like service variable to be rejected")
	}
}

func TestApplicationHasComposeServiceUsesScannedStack(t *testing.T) {
	application := db.Application{ComposeServices: []byte(`[{"name":"frontend"},{"name":"api"}]`)}
	if !applicationHasComposeService(application, "api") {
		t.Fatal("expected scanned api compose service")
	}
	if applicationHasComposeService(application, "worker") {
		t.Fatal("did not expect an unscanned compose service")
	}
}
