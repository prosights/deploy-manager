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
	Key      string `json:"key"`
	Value    string `json:"-"`
	IsPublic bool   `json:"is_public"`
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

type Connector interface {
	Provider() string
	SyncCredentials(context.Context, SyncScope) ([]CredentialInventory, error)
	RuntimeVariables(context.Context, RuntimeVariableScope) ([]RuntimeVariable, error)
}
