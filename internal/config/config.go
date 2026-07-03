package config

import (
	"fmt"
	"net"
	"net/mail"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"deploy-manager/internal/stringutil"
)

type Config struct {
	Addr                string
	DatabaseURL         string
	RedisURL            string
	StaticDir           string
	APIToken            string
	AuthDisabled        bool
	SSHSignerMode       string
	GitHubWebhookSecret string
	SlackWebhookURL     string
	ResendAPIKey        string
	ResendFromEmail     string
	ResendToEmail       string
	DopplerProject      string
	DopplerConfig       string
	DopplerToken        string
	DopplerCLIPath      string
	SSHKnownHostsPath   string
	Shutdown            time.Duration
}

func Load() Config {
	return Config{
		Addr:                env("HTTP_ADDR", ":8080"),
		DatabaseURL:         env("DATABASE_URL", "postgres://deploy:deploy@localhost:5432/deploy_manager?sslmode=disable"),
		RedisURL:            env("REDIS_URL", "redis://localhost:6379/0"),
		StaticDir:           env("STATIC_DIR", "web/dist"),
		APIToken:            env("API_TOKEN", ""),
		AuthDisabled:        boolEnv("AUTH_DISABLED", false),
		SSHSignerMode:       env("SSH_SIGNER_MODE", "file"),
		GitHubWebhookSecret: env("GITHUB_WEBHOOK_SECRET", ""),
		SlackWebhookURL:     env("SLACK_WEBHOOK_URL", ""),
		ResendAPIKey:        env("RESEND_API_KEY", ""),
		ResendFromEmail:     env("RESEND_FROM_EMAIL", ""),
		ResendToEmail:       env("RESEND_TO_EMAIL", ""),
		DopplerProject:      env("DOPPLER_PROJECT", ""),
		DopplerConfig:       env("DOPPLER_CONFIG", ""),
		DopplerToken:        env("DOPPLER_TOKEN", ""),
		DopplerCLIPath:      env("DOPPLER_CLI_PATH", "doppler"),
		SSHKnownHostsPath:   env("SSH_KNOWN_HOSTS_PATH", ""),
		Shutdown:            durationEnv("SHUTDOWN_TIMEOUT_SECONDS", 10*time.Second),
	}
}

func (c Config) Validate() error {
	if strings.TrimSpace(c.Addr) == "" {
		return fmt.Errorf("HTTP_ADDR is required")
	}
	if err := validateListenAddr("HTTP_ADDR", c.Addr); err != nil {
		return err
	}
	if strings.TrimSpace(c.DatabaseURL) == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	if err := validateRequiredURL("DATABASE_URL", c.DatabaseURL, "postgres", "postgresql"); err != nil {
		return err
	}
	if strings.TrimSpace(c.RedisURL) == "" {
		return fmt.Errorf("REDIS_URL is required")
	}
	if err := validateRequiredURL("REDIS_URL", c.RedisURL, "redis", "rediss"); err != nil {
		return err
	}
	if strings.TrimSpace(c.StaticDir) == "" {
		return fmt.Errorf("STATIC_DIR is required")
	}
	if token := strings.TrimSpace(c.APIToken); token == "" && !c.AuthDisabled {
		return fmt.Errorf("API_TOKEN is required unless AUTH_DISABLED=true")
	} else if token != "" && len(token) < 16 {
		return fmt.Errorf("API_TOKEN must be at least 16 characters")
	}
	switch strings.TrimSpace(c.SSHSignerMode) {
	case "", "file":
		// file-based static key signer (default)
	case "ca":
		return fmt.Errorf("SSH_SIGNER_MODE=ca is not yet wired; requires a certificate authority")
	default:
		return fmt.Errorf("SSH_SIGNER_MODE must be 'file' or 'ca'")
	}
	if strings.TrimSpace(c.DopplerProject) == "" && strings.TrimSpace(c.DopplerConfig) != "" {
		return fmt.Errorf("DOPPLER_PROJECT and DOPPLER_CONFIG must be provided together")
	}
	if strings.TrimSpace(c.DopplerProject) != "" && strings.TrimSpace(c.DopplerConfig) == "" {
		return fmt.Errorf("DOPPLER_PROJECT and DOPPLER_CONFIG must be provided together")
	}
	if hasAny(c.DopplerProject, c.DopplerConfig, c.DopplerToken) && strings.TrimSpace(c.DopplerCLIPath) == "" {
		return fmt.Errorf("DOPPLER_CLI_PATH is required when Doppler is configured")
	}
	if hasAny(c.ResendAPIKey, c.ResendFromEmail, c.ResendToEmail) && !hasAll(c.ResendAPIKey, c.ResendFromEmail, c.ResendToEmail) {
		return fmt.Errorf("RESEND_API_KEY, RESEND_FROM_EMAIL, and RESEND_TO_EMAIL must be provided together")
	}
	if hasAll(c.ResendAPIKey, c.ResendFromEmail, c.ResendToEmail) {
		if err := validateEmailAddress("RESEND_FROM_EMAIL", c.ResendFromEmail); err != nil {
			return err
		}
		if err := validateEmailAddress("RESEND_TO_EMAIL", c.ResendToEmail); err != nil {
			return err
		}
	}
	if err := validateOptionalHTTPURL("SLACK_WEBHOOK_URL", c.SlackWebhookURL); err != nil {
		return err
	}
	if err := validateOptionalReadableFile("SSH_KNOWN_HOSTS_PATH", c.SSHKnownHostsPath); err != nil {
		return err
	}
	return nil
}

func (c Config) DopplerConfigured() bool {
	return hasAny(c.DopplerProject, c.DopplerConfig, c.DopplerToken)
}

func env(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func boolEnv(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func durationEnv(key string, fallback time.Duration) time.Duration {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	seconds, err := strconv.Atoi(value)
	if err != nil || seconds <= 0 {
		return fallback
	}
	return time.Duration(seconds) * time.Second
}

func hasAny(values ...string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return true
		}
	}
	return false
}

func hasAll(values ...string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			return false
		}
	}
	return true
}

func validateListenAddr(name string, value string) error {
	value = strings.TrimSpace(value)
	if _, err := net.ResolveTCPAddr("tcp", value); err != nil {
		return fmt.Errorf("%s must be a valid TCP listen address", name)
	}
	return nil
}

func validateOptionalHTTPURL(name string, value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}

	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" {
		return fmt.Errorf("%s must be an absolute HTTP URL", name)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("%s must use http or https", name)
	}
	return nil
}

func validateEmailAddress(name string, value string) error {
	address, err := mail.ParseAddress(strings.TrimSpace(value))
	if err != nil || address.Address == "" {
		return fmt.Errorf("%s must be a valid email address", name)
	}
	return nil
}

func validateRequiredURL(name string, value string, schemes ...string) error {
	value = strings.TrimSpace(value)
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" {
		return fmt.Errorf("%s must be an absolute URL", name)
	}
	for _, scheme := range schemes {
		if parsed.Scheme == scheme {
			return nil
		}
	}
	return fmt.Errorf("%s must use %s", name, strings.Join(schemes, " or "))
}

func validateOptionalReadableFile(name string, value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}

	info, err := os.Stat(expandLeadingHome(value))
	if err != nil {
		return fmt.Errorf("%s must point to a readable file", name)
	}
	if info.IsDir() {
		return fmt.Errorf("%s must point to a file, not a directory", name)
	}
	return nil
}

func expandLeadingHome(path string) string {
	return stringutil.ExpandHome(path)
}
