package connectors

import (
	"context"
	"regexp"
	"strings"
)

type CredentialPermission struct {
	ResourceType string `json:"resource_type"`
	ResourceName string `json:"resource_name"`
	Permission   string `json:"permission"`
	Source       string `json:"source"`
}

type CredentialUsage struct {
	UsedByType   string `json:"used_by_type"`
	UsedByName   string `json:"used_by_name"`
	UsageContext string `json:"usage_context"`
}

type CredentialInventory struct {
	Name        string                 `json:"name"`
	Provider    string                 `json:"provider"`
	ExternalRef string                 `json:"external_ref"`
	Type        string                 `json:"type"`
	Status      string                 `json:"status"`
	Permissions []CredentialPermission `json:"permissions"`
	Usages      []CredentialUsage      `json:"usages"`
}

type RuntimeVariable struct {
	Key   string `json:"key"`
	Value string `json:"-"`
}

// RuntimeInjection is how a deployment target receives its runtime
// environment: docker compose commands run wrapped in `doppler run` on the
// target, authenticated by a short-lived read-only service token minted for a
// single deployment. Secret values never pass through Deploy Manager and are
// never written to disk on the target.
type RuntimeInjection struct {
	Project string
	Config  string
	// Token is a short-lived, read-only Doppler service token scoped to
	// Project/Config. It must only travel to the target over SSH stdin and
	// must never be logged, persisted, or placed on a command line.
	Token string `json:"-"`
}

var runtimeVariableKeyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func ValidRuntimeVariableKey(key string) bool {
	return runtimeVariableKeyPattern.MatchString(key)
}

func NormalizeCredentialStatus(status string) (string, bool) {
	status = strings.TrimSpace(status)
	if status == "" {
		return "active", true
	}

	switch status {
	case "active", "rotating", "revoked", "unknown":
		return status, true
	default:
		return "", false
	}
}

type RuntimeVariableScope struct {
	ApplicationName string
	Project         string
	Config          string
}

type SyncScope struct {
	Name   string
	Config []byte
}

// Connector deliberately has no method that returns secret values. Deploy
// Manager stores references and metadata only; runtime secret values reach
// deployment targets exclusively through Doppler runtime injection.
type Connector interface {
	Provider() string
	SyncCredentials(context.Context, SyncScope) ([]CredentialInventory, error)
}
