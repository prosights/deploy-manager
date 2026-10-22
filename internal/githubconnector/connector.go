package githubconnector

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

type config struct {
	InstallationID string       `json:"installation_id"`
	Repositories   []Repository `json:"repositories"`
}

type Repository struct {
	InstallationID  string   `json:"installation_id"`
	ApplicationID   string   `json:"application_id"`
	ApplicationName string   `json:"application_name"`
	RepositoryID    string   `json:"repository_id"`
	Repository      string   `json:"repository"`
	Branch          string   `json:"branch"`
	WorkflowID      string   `json:"workflow_id"`
	BuildContext    string   `json:"build_context"`
	Dockerfile      string   `json:"dockerfile"`
	ImageRef        string   `json:"image_ref"`
	BuildMatrix     string   `json:"build_matrix"`
	Runner          string   `json:"runner"`
	PathFilters     []string `json:"path_filters"`
}

type Config struct {
	InstallationID string
	Repositories   []Repository
}

func RepositoriesFromConfig(raw []byte) ([]Repository, error) {
	cfg, err := ParseConfig(raw)
	if err != nil {
		return nil, err
	}
	if len(cfg.Repositories) == 0 {
		return nil, fmt.Errorf("github connector config requires repositories")
	}

	repositories := make([]Repository, 0, len(cfg.Repositories))
	seen := map[string]struct{}{}
	for _, repository := range cfg.Repositories {
		if repository.InstallationID == "" {
			repository.InstallationID = cfg.InstallationID
		}
		normalized, err := normalizeRepository(repository)
		if err != nil {
			return nil, err
		}
		key := repositoryKey(normalized)
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

func ParseConfig(raw []byte) (Config, error) {
	var cfg config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return Config{}, fmt.Errorf("parse github connector config: %w", err)
	}
	installationID := strings.TrimSpace(cfg.InstallationID)
	if installationID != "" && !validNumericID(installationID) {
		return Config{}, fmt.Errorf("installation_id must be numeric")
	}
	repositories := make([]Repository, 0, len(cfg.Repositories))
	for _, repository := range cfg.Repositories {
		if repository.InstallationID == "" {
			repository.InstallationID = installationID
		}
		normalized, err := normalizeRepository(repository)
		if err != nil {
			return Config{}, err
		}
		repositories = append(repositories, normalized)
	}
	return Config{InstallationID: installationID, Repositories: repositories}, nil
}

func normalizeRepository(input Repository) (Repository, error) {
	input.Repository = strings.TrimSpace(input.Repository)
	input.InstallationID = strings.TrimSpace(input.InstallationID)
	input.ApplicationID = strings.TrimSpace(input.ApplicationID)
	input.ApplicationName = strings.TrimSpace(input.ApplicationName)
	input.RepositoryID = strings.TrimSpace(input.RepositoryID)
	input.Branch = strings.TrimSpace(input.Branch)
	input.WorkflowID = strings.TrimSpace(input.WorkflowID)
	input.BuildContext = strings.TrimSpace(input.BuildContext)
	input.Dockerfile = strings.TrimSpace(input.Dockerfile)
	input.ImageRef = strings.TrimSpace(input.ImageRef)
	input.BuildMatrix = strings.TrimSpace(input.BuildMatrix)
	input.Runner = strings.TrimSpace(input.Runner)
	input.PathFilters = normalizePathFilters(input.PathFilters)
	if input.Branch == "" {
		input.Branch = "main"
	}
	if input.WorkflowID == "" {
		input.WorkflowID = DefaultBuildWorkflowID
	}
	if input.BuildContext == "" {
		input.BuildContext = "."
	}
	if input.Dockerfile == "" {
		input.Dockerfile = "Dockerfile"
	}
	if input.Repository == "" {
		return Repository{}, fmt.Errorf("repository is required")
	}
	if !validRepository(input.Repository) {
		return Repository{}, fmt.Errorf("repository must be owner/name")
	}
	if input.InstallationID != "" && !validNumericID(input.InstallationID) {
		return Repository{}, fmt.Errorf("installation_id must be numeric")
	}
	if input.RepositoryID != "" && !validNumericID(input.RepositoryID) {
		return Repository{}, fmt.Errorf("repository_id must be numeric")
	}
	if input.ApplicationID != "" && !validUUID(input.ApplicationID) {
		return Repository{}, fmt.Errorf("application_id must be a uuid")
	}
	if !validBranch(input.Branch) {
		return Repository{}, fmt.Errorf("branch contains unsupported characters")
	}
	if !validWorkflowID(input.WorkflowID) {
		return Repository{}, fmt.Errorf("workflow_id must be a workflow file name or numeric id")
	}
	if !validBuildPath(input.BuildContext) {
		return Repository{}, fmt.Errorf("build_context contains unsupported characters")
	}
	if !validBuildPath(input.Dockerfile) {
		return Repository{}, fmt.Errorf("dockerfile contains unsupported characters")
	}
	if input.ImageRef != "" && !validImageRef(input.ImageRef) {
		return Repository{}, fmt.Errorf("image_ref must not contain whitespace or control characters")
	}
	if input.BuildMatrix != "" && !validBuildMatrix(input.BuildMatrix) {
		return Repository{}, fmt.Errorf("build_matrix must be a compact JSON string without control characters")
	}
	if input.Runner != "" && !validRunner(input.Runner) {
		return Repository{}, fmt.Errorf("runner contains unsupported characters")
	}
	for _, filter := range input.PathFilters {
		if !validBuildPath(filter) {
			return Repository{}, fmt.Errorf("path_filters contains unsupported characters")
		}
	}
	return input, nil
}

var repositoryPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
var branchPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$`)
var numericIDPattern = regexp.MustCompile(`^[0-9]+$`)
var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var imageRefPattern = regexp.MustCompile(`^[^[:space:][:cntrl:]]{1,512}$`)

const DefaultBuildWorkflowID = "deploy-manager-build.yml"

func validRepository(value string) bool {
	return repositoryPattern.MatchString(value)
}

func validBranch(value string) bool {
	return branchPattern.MatchString(value) && !strings.Contains(value, "..") && !strings.Contains(value, "//")
}

func validNumericID(value string) bool {
	return numericIDPattern.MatchString(value)
}

func validUUID(value string) bool {
	return uuidPattern.MatchString(value)
}

func validWorkflowID(value string) bool {
	return value != "" && !strings.ContainsAny(value, "/\\\r\n\t")
}

func validBuildPath(value string) bool {
	return value != "" && !strings.ContainsAny(value, "\r\n\t") && !strings.Contains(value, "..")
}

func validImageRef(value string) bool {
	return imageRefPattern.MatchString(value)
}

func validBuildMatrix(value string) bool {
	return value != "" && len(value) <= 8192 && !strings.ContainsAny(value, "\r\n\t")
}

func validRunner(value string) bool {
	return value != "" && !strings.ContainsAny(value, "\r\n\t")
}

func normalizePathFilters(values []string) []string {
	seen := map[string]struct{}{}
	filters := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.Trim(strings.TrimSpace(value), "/")
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		filters = append(filters, value)
	}
	return filters
}

func repositoryKey(repository Repository) string {
	parts := []string{
		strings.ToLower(repository.Repository),
		repository.Branch,
		strings.ToLower(repository.ApplicationID),
		strings.ToLower(repository.ApplicationName),
		strings.Join(repository.PathFilters, ","),
	}
	return strings.Join(parts, "#")
}
