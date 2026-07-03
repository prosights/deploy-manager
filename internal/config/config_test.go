package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestValidateRequiresDopplerProjectAndConfigTogether(t *testing.T) {
	cfg := validConfig()
	cfg.DopplerProject = "billing"

	if err := cfg.Validate(); err == nil {
		t.Fatal("expected partial Doppler config to fail")
	}
}

func TestValidateRequiresAPITokenUnlessAuthDisabled(t *testing.T) {
	cfg := validConfig()
	cfg.APIToken = ""

	if err := cfg.Validate(); err == nil {
		t.Fatal("expected missing API token to fail")
	}

	cfg.AuthDisabled = true
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestValidateRequiresDopplerCLIPathWhenDopplerConfigured(t *testing.T) {
	cfg := validConfig()
	cfg.DopplerProject = "billing"
	cfg.DopplerConfig = "prd"
	cfg.DopplerCLIPath = " "

	if err := cfg.Validate(); err == nil {
		t.Fatal("expected missing Doppler CLI path to fail")
	}
}

func TestDopplerConfiguredReflectsAnyDopplerRuntimeInput(t *testing.T) {
	cfg := validConfig()
	if cfg.DopplerConfigured() {
		t.Fatal("did not expect blank Doppler config to be enabled")
	}

	cfg.DopplerToken = "token"
	if !cfg.DopplerConfigured() {
		t.Fatal("expected Doppler token to enable Doppler readiness")
	}
}

func TestValidateRequiresCompleteResendConfig(t *testing.T) {
	cfg := validConfig()
	cfg.ResendAPIKey = "key"
	cfg.ResendFromEmail = "deploy@example.com"

	if err := cfg.Validate(); err == nil {
		t.Fatal("expected partial Resend config to fail")
	}
}

func TestValidateRejectsInvalidResendEmailAddresses(t *testing.T) {
	for name, mutate := range map[string]func(*Config){
		"from": func(cfg *Config) { cfg.ResendFromEmail = "not an email" },
		"to":   func(cfg *Config) { cfg.ResendToEmail = "ops" },
	} {
		t.Run(name, func(t *testing.T) {
			cfg := validConfig()
			cfg.ResendAPIKey = "key"
			cfg.ResendFromEmail = "Deploy <deploy@example.com>"
			cfg.ResendToEmail = "ops@example.com"
			mutate(&cfg)

			if err := cfg.Validate(); err == nil {
				t.Fatal("expected invalid Resend email to fail")
			}
		})
	}
}

func TestValidateRejectsInvalidSlackWebhookURL(t *testing.T) {
	for _, webhookURL := range []string{"hooks.slack.test/path", "ftp://hooks.slack.test/path"} {
		t.Run(webhookURL, func(t *testing.T) {
			cfg := validConfig()
			cfg.SlackWebhookURL = webhookURL

			if err := cfg.Validate(); err == nil {
				t.Fatal("expected invalid Slack webhook URL to fail")
			}
		})
	}
}

func TestValidateAllowsKnownHostsPathWhenFileExists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	if err := os.WriteFile(path, []byte{}, 0o600); err != nil {
		t.Fatal(err)
	}

	cfg := validConfig()
	cfg.SSHKnownHostsPath = path

	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestValidateRejectsInvalidKnownHostsPath(t *testing.T) {
	for name, path := range map[string]string{
		"missing":   filepath.Join(t.TempDir(), "missing_known_hosts"),
		"directory": t.TempDir(),
	} {
		t.Run(name, func(t *testing.T) {
			cfg := validConfig()
			cfg.SSHKnownHostsPath = path

			if err := cfg.Validate(); err == nil {
				t.Fatal("expected invalid known_hosts path to fail")
			}
		})
	}
}

func TestValidateAllowsOptionalIntegrationsWhenComplete(t *testing.T) {
	cfg := validConfig()
	cfg.DopplerProject = "billing"
	cfg.DopplerConfig = "prd"
	cfg.ResendAPIKey = "key"
	cfg.ResendFromEmail = "Deploy <deploy@example.com>"
	cfg.ResendToEmail = "ops@example.com"
	cfg.SlackWebhookURL = "https://hooks.slack.test"
	cfg.GitHubWebhookSecret = "secret"

	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestValidateRequiresRuntimeEndpoints(t *testing.T) {
	for name, mutate := range map[string]func(*Config){
		"http addr": func(cfg *Config) { cfg.Addr = " " },
		"database":  func(cfg *Config) { cfg.DatabaseURL = " " },
		"redis":     func(cfg *Config) { cfg.RedisURL = " " },
		"static":    func(cfg *Config) { cfg.StaticDir = " " },
	} {
		t.Run(name, func(t *testing.T) {
			cfg := validConfig()
			mutate(&cfg)
			if err := cfg.Validate(); err == nil {
				t.Fatal("expected missing runtime endpoint to fail")
			}
		})
	}
}

func TestValidateRejectsInvalidRuntimeEndpointURLs(t *testing.T) {
	for name, mutate := range map[string]func(*Config){
		"http addr missing port": func(cfg *Config) { cfg.Addr = "localhost" },
		"http addr bad port":     func(cfg *Config) { cfg.Addr = ":port" },
		"database malformed":     func(cfg *Config) { cfg.DatabaseURL = "postgres:// " },
		"database scheme":        func(cfg *Config) { cfg.DatabaseURL = "mysql://db:3306/app" },
		"redis malformed":        func(cfg *Config) { cfg.RedisURL = "redis:// " },
		"redis scheme":           func(cfg *Config) { cfg.RedisURL = "http://redis:6379" },
	} {
		t.Run(name, func(t *testing.T) {
			cfg := validConfig()
			mutate(&cfg)
			if err := cfg.Validate(); err == nil {
				t.Fatal("expected invalid runtime endpoint URL to fail")
			}
		})
	}
}

func TestValidateAllowsSupportedRuntimeEndpointSchemes(t *testing.T) {
	for name, mutate := range map[string]func(*Config){
		"http addr wildcard": func(cfg *Config) { cfg.Addr = ":8080" },
		"http addr host":     func(cfg *Config) { cfg.Addr = "127.0.0.1:8080" },
		"postgres":           func(cfg *Config) { cfg.DatabaseURL = "postgres://deploy:deploy@db:5432/deploy_manager" },
		"postgresql":         func(cfg *Config) { cfg.DatabaseURL = "postgresql://deploy:deploy@db:5432/deploy_manager" },
		"redis":              func(cfg *Config) { cfg.RedisURL = "redis://redis:6379/0" },
		"rediss":             func(cfg *Config) { cfg.RedisURL = "rediss://redis:6379/0" },
	} {
		t.Run(name, func(t *testing.T) {
			cfg := validConfig()
			mutate(&cfg)
			if err := cfg.Validate(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestEnvTrimsWhitespaceBeforeFallback(t *testing.T) {
	t.Setenv("DEPLOY_MANAGER_TEST_ENV", " value ")
	if got := env("DEPLOY_MANAGER_TEST_ENV", "fallback"); got != "value" {
		t.Fatalf("expected trimmed env value, got %q", got)
	}

	t.Setenv("DEPLOY_MANAGER_TEST_ENV", "   ")
	if got := env("DEPLOY_MANAGER_TEST_ENV", "fallback"); got != "fallback" {
		t.Fatalf("expected fallback for blank env value, got %q", got)
	}
}

func validConfig() Config {
	return Config{
		Addr:           ":8080",
		DatabaseURL:    "postgres://deploy:deploy@db:5432/deploy_manager",
		RedisURL:       "redis://redis:6379/0",
		StaticDir:      "web/dist",
		APIToken:       "supersecrettoken123",
		DopplerCLIPath: "doppler",
	}
}
