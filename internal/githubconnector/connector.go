package githubconnector

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"deploy-manager/internal/connectors"
)

type Connector struct{}

type config struct {
	Repositories []RepositoryInventory `json:"repositories"`
}

type RepositoryInventory struct {
	Repository     string                       `json:"repository"`
	CredentialName string                       `json:"credential_name"`
	ExternalRef    string                       `json:"external_ref"`
	CredentialType string                       `json:"credential_type"`
	Status         string                       `json:"status"`
	Permissions    []string                     `json:"permissions"`
	Usages         []connectors.CredentialUsage `json:"usages"`
}

func New() Connector {
	return Connector{}
}

func (Connector) Provider() string {
	return "github"
}

func (Connector) SyncCredentials(_ context.Context, scope connectors.SyncScope) ([]connectors.CredentialInventory, error) {
	var cfg config
	if err := json.Unmarshal(scope.Config, &cfg); err != nil {
		return nil, fmt.Errorf("parse github connector config: %w", err)
	}
	if len(cfg.Repositories) == 0 {
		return nil, fmt.Errorf("github connector config requires repositories")
	}

	inventory := make([]connectors.CredentialInventory, 0, len(cfg.Repositories))
	for _, repository := range cfg.Repositories {
		item, err := toCredentialInventory(repository)
		if err != nil {
			return nil, err
		}
		inventory = append(inventory, item)
	}
	return inventory, nil
}

func (Connector) RuntimeVariables(context.Context, connectors.RuntimeVariableScope) ([]connectors.RuntimeVariable, error) {
	return nil, nil
}

func toCredentialInventory(input RepositoryInventory) (connectors.CredentialInventory, error) {
	input.Repository = strings.TrimSpace(input.Repository)
	input.CredentialName = strings.TrimSpace(input.CredentialName)
	input.ExternalRef = strings.TrimSpace(input.ExternalRef)
	input.CredentialType = strings.TrimSpace(input.CredentialType)

	status, ok := connectors.NormalizeCredentialStatus(input.Status)
	if !ok {
		return connectors.CredentialInventory{}, fmt.Errorf("credential status must be active, rotating, revoked, or unknown")
	}
	input.Status = status
	if input.CredentialType == "" {
		input.CredentialType = "deploy_key"
	}
	if input.Repository == "" || input.CredentialName == "" || input.ExternalRef == "" {
		return connectors.CredentialInventory{}, fmt.Errorf("repository, credential_name, and external_ref are required")
	}
	if !validRepository(input.Repository) {
		return connectors.CredentialInventory{}, fmt.Errorf("repository must be owner/name")
	}

	permissions := make([]connectors.CredentialPermission, 0, len(input.Permissions))
	for _, permission := range input.Permissions {
		permission = strings.TrimSpace(permission)
		if permission == "" {
			continue
		}
		permissions = append(permissions, connectors.CredentialPermission{
			ResourceType: "repository",
			ResourceName: input.Repository,
			Permission:   permission,
			Source:       "github",
		})
	}

	usages := make([]connectors.CredentialUsage, 0, len(input.Usages))
	for _, usage := range input.Usages {
		usage.UsedByType = strings.TrimSpace(usage.UsedByType)
		usage.UsedByName = strings.TrimSpace(usage.UsedByName)
		usage.UsageContext = strings.TrimSpace(usage.UsageContext)
		if usage.UsedByType == "" || usage.UsedByName == "" || usage.UsageContext == "" {
			continue
		}
		usages = append(usages, usage)
	}
	if len(usages) == 0 {
		usages = append(usages, connectors.CredentialUsage{
			UsedByType:   "repository",
			UsedByName:   input.Repository,
			UsageContext: "repository access for deployment builds",
		})
	}

	return connectors.CredentialInventory{
		Name:        input.CredentialName,
		Provider:    "github",
		ExternalRef: input.ExternalRef,
		Type:        input.CredentialType,
		Status:      input.Status,
		Permissions: permissions,
		Usages:      usages,
	}, nil
}

var repositoryPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

func validRepository(value string) bool {
	return repositoryPattern.MatchString(value)
}
