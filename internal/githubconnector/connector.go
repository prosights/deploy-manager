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
	Repositories []Repository `json:"repositories"`
}

type Repository struct {
	Repository     string                       `json:"repository"`
	Branch         string                       `json:"branch"`
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
	repositories, err := RepositoriesFromConfig(scope.Config)
	if err != nil {
		return nil, err
	}

	inventory := make([]connectors.CredentialInventory, 0, len(repositories))
	for _, repository := range repositories {
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

func RepositoriesFromConfig(raw []byte) ([]Repository, error) {
	var cfg config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("parse github connector config: %w", err)
	}
	if len(cfg.Repositories) == 0 {
		return nil, fmt.Errorf("github connector config requires repositories")
	}

	repositories := make([]Repository, 0, len(cfg.Repositories))
	seen := map[string]struct{}{}
	for _, repository := range cfg.Repositories {
		normalized, err := normalizeRepository(repository)
		if err != nil {
			return nil, err
		}
		key := strings.ToLower(normalized.Repository + "#" + normalized.Branch)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		repositories = append(repositories, normalized)
	}
	if len(repositories) == 0 {
		return nil, fmt.Errorf("github connector config requires repositories")
	}
	return repositories, nil
}

func normalizeRepository(input Repository) (Repository, error) {
	input.Repository = strings.TrimSpace(input.Repository)
	input.Branch = strings.TrimSpace(input.Branch)
	input.CredentialName = strings.TrimSpace(input.CredentialName)
	input.ExternalRef = strings.TrimSpace(input.ExternalRef)
	input.CredentialType = strings.TrimSpace(input.CredentialType)
	if input.Branch == "" {
		input.Branch = "main"
	}
	if input.CredentialName == "" {
		input.CredentialName = input.Repository + " GitHub App"
	}
	if input.ExternalRef == "" {
		input.ExternalRef = "github-app:" + input.Repository
	}

	status, ok := connectors.NormalizeCredentialStatus(input.Status)
	if !ok {
		return Repository{}, fmt.Errorf("credential status must be active, rotating, revoked, or unknown")
	}
	input.Status = status
	if input.CredentialType == "" {
		input.CredentialType = "github_app_installation"
	}
	if input.Repository == "" || input.CredentialName == "" || input.ExternalRef == "" {
		return Repository{}, fmt.Errorf("repository is required")
	}
	if !validRepository(input.Repository) {
		return Repository{}, fmt.Errorf("repository must be owner/name")
	}
	if !validBranch(input.Branch) {
		return Repository{}, fmt.Errorf("branch contains unsupported characters")
	}
	return input, nil
}

func toCredentialInventory(input Repository) (connectors.CredentialInventory, error) {
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
var branchPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$`)

func validRepository(value string) bool {
	return repositoryPattern.MatchString(value)
}

func validBranch(value string) bool {
	return branchPattern.MatchString(value) && !strings.Contains(value, "..") && !strings.Contains(value, "//")
}
