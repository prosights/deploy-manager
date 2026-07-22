package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path"
	"sort"
	"strconv"
	"strings"

	"deploy-manager/internal/db"
	"deploy-manager/internal/deployments"
	"deploy-manager/internal/githubconnector"
	"deploy-manager/internal/stringutil"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"gopkg.in/yaml.v3"
)

type githubRepositoryResponse struct {
	ConnectorID     string   `json:"connector_id"`
	ConnectorName   string   `json:"connector_name"`
	InstallationID  string   `json:"installation_id"`
	ApplicationID   string   `json:"application_id"`
	ApplicationName string   `json:"application_name"`
	Repository      string   `json:"repository"`
	Branch          string   `json:"branch"`
	WorkflowID      string   `json:"workflow_id"`
	BuildContext    string   `json:"build_context"`
	Dockerfile      string   `json:"dockerfile"`
	ImageRef        string   `json:"image_ref"`
	BuildMatrix     string   `json:"build_matrix"`
	Runner          string   `json:"runner"`
	PathFilters     []string `json:"path_filters"`
	CloneURL        string   `json:"clone_url"`
	WebURL          string   `json:"web_url"`
}

func (s Server) listGitHubRepositories(w http.ResponseWriter, r *http.Request) {
	accounts, err := s.queries.ListConnectorAccounts(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}

	repositories := make([]githubRepositoryResponse, 0)
	for _, account := range accounts {
		if account.Provider != "github" || !account.Enabled {
			continue
		}
		items, err := githubconnector.RepositoriesFromConfig(account.Config)
		if err != nil {
			continue
		}
		for _, item := range items {
			repositories = append(repositories, githubRepositoryResponse{
				ConnectorID:     uuidString(account.ID),
				ConnectorName:   account.Name,
				InstallationID:  item.InstallationID,
				ApplicationID:   item.ApplicationID,
				ApplicationName: item.ApplicationName,
				Repository:      item.Repository,
				Branch:          item.Branch,
				WorkflowID:      item.WorkflowID,
				BuildContext:    item.BuildContext,
				Dockerfile:      item.Dockerfile,
				ImageRef:        item.ImageRef,
				BuildMatrix:     item.BuildMatrix,
				Runner:          item.Runner,
				PathFilters:     item.PathFilters,
				CloneURL:        "https://github.com/" + item.Repository + ".git",
				WebURL:          "https://github.com/" + item.Repository,
			})
		}
	}

	writeJSON(w, http.StatusOK, repositories)
}

type githubRepositorySyncResponse struct {
	Connector    connectorAccountResponse   `json:"connector"`
	Repositories []githubRepositoryResponse `json:"repositories"`
}

type githubDetectedService struct {
	Name            string                 `json:"name"`
	Root            string                 `json:"root"`
	ComposePath     string                 `json:"compose_path"`
	PathFilters     []string               `json:"path_filters"`
	ComposeServices []githubComposeService `json:"compose_services"`
}

type githubComposeService struct {
	Name          string              `json:"name"`
	Image         string              `json:"image,omitempty"`
	BuildContext  string              `json:"build_context,omitempty"`
	Dockerfile    string              `json:"dockerfile,omitempty"`
	Ports         []githubComposePort `json:"ports"`
	DependsOn     []string            `json:"depends_on"`
	ExecutionMode string              `json:"execution_mode,omitempty"`
}

type githubComposePort struct {
	ContainerPort int    `json:"container_port"`
	PublishedPort int    `json:"published_port,omitempty"`
	Protocol      string `json:"protocol,omitempty"`
	Variable      string `json:"variable,omitempty"`
}

type githubDetectServicesResponse struct {
	Repository string                  `json:"repository"`
	Branch     string                  `json:"branch"`
	Services   []githubDetectedService `json:"services"`
}

type githubImportServicesRequest struct {
	ConnectorID   string                  `json:"connector_id"`
	Repository    string                  `json:"repository"`
	Branch        string                  `json:"branch"`
	Root          string                  `json:"root"`
	EnvironmentID string                  `json:"environment_id"`
	ServerID      string                  `json:"server_id"`
	Services      []string                `json:"services"`
	Detected      []githubDetectedService `json:"detected_services"`
}

type githubImportServicesResponse struct {
	Applications []db.Application         `json:"applications"`
	Connector    connectorAccountResponse `json:"connector"`
}

type githubBuildDispatchRequest struct {
	Repository    string            `json:"repository"`
	ApplicationID string            `json:"application_id"`
	Branch        string            `json:"branch"`
	WorkflowID    string            `json:"workflow_id"`
	Inputs        map[string]string `json:"inputs"`
}

type githubBuildDispatchResponse struct {
	Build db.BuildRun `json:"build"`
}

func (s Server) githubInstallCallback(w http.ResponseWriter, r *http.Request) {
	if s.github.App == nil {
		writeError(w, validationError("github app is not configured"))
		return
	}
	installationID := strings.TrimSpace(r.URL.Query().Get("installation_id"))
	if installationID == "" {
		writeError(w, validationError("github callback requires installation_id"))
		return
	}
	if _, err := strconv.ParseInt(installationID, 10, 64); err != nil {
		writeError(w, validationError("installation_id must be numeric"))
		return
	}
	repositories, err := s.github.App.ListInstallationRepositories(r.Context(), installationID)
	if err != nil {
		writeError(w, err)
		return
	}
	config, err := githubConfigFromInstallationRepositories(installationID, repositories)
	if err != nil {
		writeError(w, err)
		return
	}
	input, err := normalizeConnectorAccount(db.UpsertConnectorAccountParams{
		Provider: "github",
		Name:     "GitHub",
		Enabled:  true,
		Config:   config,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	connector, err := s.queries.UpsertConnectorAccount(r.Context(), input)
	if err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "connector.github_install", "connector", uuidString(connector.ID), connector.Name, map[string]any{
		"repository_count": len(repositories),
	})
	http.Redirect(w, r, "/connectors?github=connected", http.StatusSeeOther)
}

func (s Server) syncGitHubConnectorRepositories(w http.ResponseWriter, r *http.Request) {
	if s.github.App == nil {
		writeError(w, validationError("github app is not configured"))
		return
	}
	connectorID, err := parseUUIDParam(r, "connectorID")
	if err != nil {
		writeError(w, err)
		return
	}
	account, err := s.queries.GetConnectorAccount(r.Context(), connectorID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, notFoundError("connector not found"))
			return
		}
		writeError(w, err)
		return
	}
	if account.Provider != "github" {
		writeError(w, validationError("connector must be a github connector"))
		return
	}
	cfg, err := githubconnector.ParseConfig(account.Config)
	if err != nil {
		writeError(w, validationError("github connector config "+err.Error()))
		return
	}
	if cfg.InstallationID == "" {
		writeError(w, validationError("github connector config requires installation_id"))
		return
	}
	repositories, err := s.github.App.ListInstallationRepositories(r.Context(), cfg.InstallationID)
	if err != nil {
		writeError(w, err)
		return
	}
	config, err := githubConfigFromInstallationRepositoriesWithDefaults(cfg.InstallationID, repositories, cfg.Repositories)
	if err != nil {
		writeError(w, err)
		return
	}
	input, err := normalizeConnectorAccount(db.UpsertConnectorAccountParams{
		Provider: account.Provider,
		Name:     account.Name,
		Enabled:  account.Enabled,
		Config:   config,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	updated, err := s.queries.UpsertConnectorAccount(r.Context(), input)
	if err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "connector.github_repositories_sync", "connector", uuidString(updated.ID), updated.Name, map[string]any{
		"repository_count": len(repositories),
	})
	writeJSON(w, http.StatusOK, githubRepositorySyncResponse{
		Connector:    connectorResponse(updated),
		Repositories: githubRepositoryResponses(updated, config),
	})
}

func (s Server) detectGitHubRepositoryServices(w http.ResponseWriter, r *http.Request) {
	if s.github.App == nil {
		writeError(w, validationError("github app is not configured"))
		return
	}
	connectorID := strings.TrimSpace(r.URL.Query().Get("connector_id"))
	repositoryName := strings.TrimSpace(r.URL.Query().Get("repository"))
	branch := strings.TrimSpace(r.URL.Query().Get("branch"))
	root, err := normalizeRepositoryRoot(r.URL.Query().Get("root"))
	if err != nil {
		writeError(w, err)
		return
	}
	if branch == "" {
		branch = "main"
	}
	if connectorID == "" || repositoryName == "" {
		writeError(w, validationError("connector_id and repository are required"))
		return
	}
	id, err := stringutil.PgUUID(connectorID)
	if err != nil {
		writeError(w, validationError("connector_id must be a uuid"))
		return
	}
	account, err := s.queries.GetConnectorAccount(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, notFoundError("connector not found"))
			return
		}
		writeError(w, err)
		return
	}
	repository, err := githubConnectorRepository(account.Config, repositoryName, branch)
	if err != nil {
		writeError(w, err)
		return
	}
	if repository.InstallationID == "" {
		writeError(w, validationError("repository has no github installation"))
		return
	}
	services, err := s.detectRepositoryServices(r, repository, root)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, githubDetectServicesResponse{
		Repository: repository.Repository,
		Branch:     repository.Branch,
		Services:   services,
	})
}

type githubRepositoryBranchesResponse struct {
	Repository string   `json:"repository"`
	Branches   []string `json:"branches"`
}

func (s Server) listGitHubRepositoryBranches(w http.ResponseWriter, r *http.Request) {
	if s.github.App == nil {
		writeError(w, validationError("github app is not configured"))
		return
	}
	connectorID := strings.TrimSpace(r.URL.Query().Get("connector_id"))
	repositoryName := strings.TrimSpace(r.URL.Query().Get("repository"))
	if connectorID == "" || repositoryName == "" {
		writeError(w, validationError("connector_id and repository are required"))
		return
	}
	id, err := stringutil.PgUUID(connectorID)
	if err != nil {
		writeError(w, validationError("connector_id must be a uuid"))
		return
	}
	account, err := s.queries.GetConnectorAccount(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, notFoundError("connector not found"))
			return
		}
		writeError(w, err)
		return
	}
	repository, err := githubConnectorRepositoryAnyBranch(account.Config, repositoryName)
	if err != nil {
		writeError(w, err)
		return
	}
	if repository.InstallationID == "" {
		writeError(w, validationError("repository has no github installation"))
		return
	}
	branches, err := s.github.App.ListRepositoryBranches(r.Context(), repository.InstallationID, repository.Repository)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, githubRepositoryBranchesResponse{
		Repository: repository.Repository,
		Branches:   branches,
	})
}

func (s Server) getGitHubRepositoryCommit(w http.ResponseWriter, r *http.Request) {
	if s.github.App == nil {
		writeError(w, validationError("github app is not configured"))
		return
	}
	connectorID := strings.TrimSpace(r.URL.Query().Get("connector_id"))
	repositoryName := strings.TrimSpace(r.URL.Query().Get("repository"))
	sha := strings.TrimSpace(r.URL.Query().Get("sha"))
	if connectorID == "" || repositoryName == "" || sha == "" {
		writeError(w, validationError("connector_id, repository, and sha are required"))
		return
	}
	if !deployments.ValidCommitSHA(sha) {
		writeError(w, validationError("sha must be a 7 to 40 character hexadecimal commit"))
		return
	}
	id, err := stringutil.PgUUID(connectorID)
	if err != nil {
		writeError(w, validationError("connector_id must be a uuid"))
		return
	}
	account, err := s.queries.GetConnectorAccount(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, notFoundError("connector not found"))
			return
		}
		writeError(w, err)
		return
	}
	if account.Provider != "github" || !account.Enabled {
		writeError(w, validationError("connector must be an enabled github connector"))
		return
	}
	repository, err := githubConnectorRepositoryAnyBranch(account.Config, repositoryName)
	if err != nil {
		writeError(w, err)
		return
	}
	if repository.InstallationID == "" {
		writeError(w, validationError("repository has no github installation"))
		return
	}
	commit, err := s.github.App.GetRepositoryCommit(r.Context(), repository.InstallationID, repository.Repository, sha)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, commit)
}

func (s Server) importGitHubRepositoryServices(w http.ResponseWriter, r *http.Request) {
	projectID, err := parseUUIDParam(r, "projectID")
	if err != nil {
		writeError(w, err)
		return
	}
	var request githubImportServicesRequest
	if err := readJSON(w, r, &request); err != nil {
		writeError(w, err)
		return
	}
	request.Branch = strings.TrimSpace(request.Branch)
	if request.Branch == "" {
		request.Branch = "main"
	}
	request.Root, err = normalizeRepositoryRoot(request.Root)
	if err != nil {
		writeError(w, err)
		return
	}
	connectorID, err := stringutil.PgUUID(request.ConnectorID)
	if err != nil {
		writeError(w, validationError("connector_id must be a uuid"))
		return
	}
	environmentID, err := stringutil.PgUUID(request.EnvironmentID)
	if err != nil {
		writeError(w, validationError("environment_id must be a uuid"))
		return
	}
	serverID, err := stringutil.PgUUID(request.ServerID)
	if err != nil {
		writeError(w, validationError("server_id must be a uuid"))
		return
	}
	environment, err := s.queries.GetEnvironment(r.Context(), environmentID)
	if err != nil {
		writeError(w, applicationLookupError(err, "environment not found"))
		return
	}
	if environment.ProjectID != projectID {
		writeError(w, validationError("environment does not belong to this project"))
		return
	}
	if _, err := s.queries.GetServer(r.Context(), serverID); err != nil {
		writeError(w, applicationLookupError(err, "server not found"))
		return
	}
	project, err := s.queries.GetProject(r.Context(), projectID)
	if err != nil {
		writeError(w, applicationLookupError(err, "project not found"))
		return
	}
	account, err := s.queries.GetConnectorAccount(r.Context(), connectorID)
	if err != nil {
		writeError(w, applicationLookupError(err, "connector not found"))
		return
	}
	repository, err := githubConnectorRepository(account.Config, request.Repository, request.Branch)
	if err != nil {
		writeError(w, err)
		return
	}
	services := request.Detected
	if len(services) == 0 {
		writeError(w, validationError("scan repository before importing services"))
		return
	}
	selected := selectedServiceNames(request.Services)
	applications := make([]db.Application, 0, len(services))
	if s.tx == nil {
		writeError(w, errors.New("database transactions are unavailable"))
		return
	}
	tx, err := s.tx.Begin(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	queries := s.queries.WithTx(tx)
	for _, service := range services {
		if len(selected) > 0 && !selected[service.Name] {
			continue
		}
		input, err := normalizeCreateApplication(db.CreateApplicationParams{
			EnvironmentID:    environmentID,
			ServerID:         serverID,
			Name:             service.Name,
			RepositoryUrl:    blankStringAsText("https://github.com/" + repository.Repository + ".git"),
			Branch:           repository.Branch,
			ComposePath:      service.ComposePath,
			RemoteDirectory:  "/srv/deploy-manager/apps/" + project.Slug + "/" + environment.Slug + "/" + service.Name,
			HealthCheckUrl:   blankStringAsText("http://127.0.0.1:{port}/?color={color}"),
			GithubAutoDeploy: true,
		})
		if err != nil {
			writeError(w, err)
			return
		}
		app, err := queries.CreateApplication(r.Context(), input)
		if err != nil {
			writeError(w, err)
			return
		}
		if len(service.ComposeServices) > 0 {
			metadata, err := json.Marshal(service.ComposeServices)
			if err != nil {
				writeError(w, err)
				return
			}
			app, err = queries.UpdateApplicationComposeServices(r.Context(), db.UpdateApplicationComposeServicesParams{
				ID:              app.ID,
				ComposeServices: metadata,
			})
			if err != nil {
				writeError(w, err)
				return
			}
		}
		applications = append(applications, app)
	}
	if len(applications) == 0 {
		writeError(w, validationError("no detected services selected"))
		return
	}
	updated := account
	// First import wires the project to its source repository so the project
	// page shows one repo/branch of record.
	if !project.RepositoryFullName.Valid {
		if _, err := queries.UpdateProjectRepository(r.Context(), db.UpdateProjectRepositoryParams{
			ID:                    projectID,
			RepositoryConnectorID: account.ID,
			RepositoryFullName:    blankStringAsText(repository.Repository),
			RepositoryBranch:      blankStringAsText(repository.Branch),
		}); err != nil {
			writeError(w, err)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "github.services_import", "project", uuidString(project.ID), project.Name, map[string]any{
		"repository": repository.Repository,
		"services":   len(applications),
	})
	writeJSON(w, http.StatusCreated, githubImportServicesResponse{Applications: applications, Connector: connectorResponse(updated)})
}

func selectedServiceNames(values []string) map[string]bool {
	selected := make(map[string]bool, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			selected[value] = true
		}
	}
	return selected
}

func (s Server) detectRepositoryServices(r *http.Request, repository githubconnector.Repository, rootDirectory string) ([]githubDetectedService, error) {
	root, err := s.github.App.ListRepositoryContents(r.Context(), repository.InstallationID, repository.Repository, rootDirectory, repository.Branch)
	if err != nil {
		return nil, err
	}
	services := make([]githubDetectedService, 0)
	if composePath := detectedComposePath(root); composePath != "" {
		composeServices, err := s.detectComposeServices(r, repository, composePath)
		if err != nil {
			return nil, err
		}
		serviceName := repositoryServiceName(repository.Repository)
		if rootDirectory != "" {
			serviceName = path.Base(rootDirectory)
		}
		services = append(services, githubDetectedService{
			Name:            serviceName,
			Root:            displayRepositoryRoot(rootDirectory),
			ComposePath:     composePath,
			PathFilters:     repositoryPathFilters(rootDirectory),
			ComposeServices: composeServices,
		})
	}
	for _, item := range root {
		if item.Type != "dir" || item.Name == "" {
			continue
		}
		children, err := s.github.App.ListRepositoryContents(r.Context(), repository.InstallationID, repository.Repository, item.Path, repository.Branch)
		if err != nil {
			continue
		}
		if composePath := detectedComposePath(children); composePath != "" {
			composeServices, err := s.detectComposeServices(r, repository, composePath)
			if err != nil {
				return nil, err
			}
			services = append(services, githubDetectedService{
				Name:            item.Name,
				Root:            item.Path,
				ComposePath:     composePath,
				PathFilters:     []string{item.Path + "/**"},
				ComposeServices: composeServices,
			})
		}
	}
	return services, nil
}

func normalizeRepositoryRoot(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || value == "." {
		return "", nil
	}
	if strings.HasPrefix(value, "/") || strings.Contains(value, "\\") || strings.ContainsAny(value, "\r\n\t") {
		return "", validationError("root must be a relative repository directory")
	}
	for _, part := range strings.Split(value, "/") {
		if part == ".." {
			return "", validationError("root must not contain '..'")
		}
	}
	value = strings.Trim(path.Clean(value), "/")
	if value == "." {
		return "", nil
	}
	return value, nil
}

func displayRepositoryRoot(root string) string {
	if root == "" {
		return "."
	}
	return root
}

func repositoryPathFilters(root string) []string {
	if root == "" {
		return []string{"**"}
	}
	return []string{root + "/**"}
}

type composeDocument struct {
	Services map[string]composeService `yaml:"services"`
}

type composeService struct {
	Image     string      `yaml:"image"`
	Build     yaml.Node   `yaml:"build"`
	Ports     []yaml.Node `yaml:"ports"`
	Expose    []yaml.Node `yaml:"expose"`
	DependsOn yaml.Node   `yaml:"depends_on"`
}

func (s Server) detectComposeServices(r *http.Request, repository githubconnector.Repository, composePath string) ([]githubComposeService, error) {
	contents, err := s.github.App.GetRepositoryFile(r.Context(), repository.InstallationID, repository.Repository, composePath, repository.Branch)
	if err != nil {
		return nil, err
	}
	var document composeDocument
	if err := yaml.Unmarshal(contents, &document); err != nil {
		return nil, validationError("invalid compose file " + composePath + ": " + err.Error())
	}
	services := make([]githubComposeService, 0, len(document.Services))
	for name, service := range document.Services {
		buildContext, dockerfile := composeBuild(service.Build)
		ports := make([]githubComposePort, 0, len(service.Ports)+len(service.Expose))
		seenPorts := make(map[string]bool)
		for _, port := range append(service.Ports, service.Expose...) {
			if value, ok := composePort(port); ok {
				key := fmt.Sprintf("%d/%s", value.ContainerPort, value.Protocol)
				if seenPorts[key] {
					continue
				}
				seenPorts[key] = true
				ports = append(ports, value)
			}
		}
		dependsOn := composeDependencies(service.DependsOn)
		sort.Strings(dependsOn)
		services = append(services, githubComposeService{
			Name:         name,
			Image:        service.Image,
			BuildContext: buildContext,
			Dockerfile:   dockerfile,
			Ports:        ports,
			DependsOn:    dependsOn,
		})
	}
	sort.Slice(services, func(i, j int) bool { return services[i].Name < services[j].Name })
	return services, nil
}

func composeBuild(node yaml.Node) (string, string) {
	if node.Kind == yaml.ScalarNode {
		return node.Value, ""
	}
	if node.Kind == yaml.MappingNode {
		return yamlMapValue(node, "context"), yamlMapValue(node, "dockerfile")
	}
	return "", ""
}

func composePort(node yaml.Node) (githubComposePort, bool) {
	if node.Kind == yaml.ScalarNode {
		value := node.Value
		protocol := ""
		if slash := strings.LastIndex(value, "/"); slash >= 0 {
			protocol = value[slash+1:]
			value = value[:slash]
		}
		containerValue, publishedValue, hasPublished := splitComposePort(value)
		containerPort, err := strconv.Atoi(containerValue)
		if err != nil || containerPort < 1 || containerPort > 65535 {
			return githubComposePort{}, false
		}
		port := githubComposePort{ContainerPort: containerPort, Protocol: protocol}
		if hasPublished {
			publishedPort, variable, ok := composePublishedPort(publishedValue)
			if !ok {
				return githubComposePort{}, false
			}
			port.PublishedPort = publishedPort
			port.Variable = variable
		}
		return port, true
	}
	if node.Kind != yaml.MappingNode {
		return githubComposePort{}, false
	}
	target, err := strconv.Atoi(yamlMapValue(node, "target"))
	if err != nil || target < 1 || target > 65535 {
		return githubComposePort{}, false
	}
	port := githubComposePort{ContainerPort: target, Protocol: yamlMapValue(node, "protocol")}
	if published := yamlMapValue(node, "published"); published != "" {
		value, variable, ok := composePublishedPort(published)
		if !ok {
			return githubComposePort{}, false
		}
		port.PublishedPort = value
		port.Variable = variable
	}
	return port, true
}

func splitComposePort(value string) (container string, published string, hasPublished bool) {
	separator := lastComposePortSeparator(value)
	if separator < 0 {
		return value, "", false
	}
	container = value[separator+1:]
	prefix := value[:separator]
	if separator = lastComposePortSeparator(prefix); separator >= 0 {
		prefix = prefix[separator+1:]
	}
	return container, prefix, true
}

func lastComposePortSeparator(value string) int {
	curly, square := 0, 0
	for index := len(value) - 1; index >= 0; index-- {
		switch value[index] {
		case '}':
			curly++
		case '{':
			curly--
		case ']':
			square++
		case '[':
			square--
		case ':':
			if curly == 0 && square == 0 {
				return index
			}
		}
	}
	return -1
}

func composePublishedPort(value string) (int, string, bool) {
	value = strings.TrimSpace(value)
	variable := ""
	fallback := ""
	if strings.HasPrefix(value, "${") && strings.HasSuffix(value, "}") {
		contents := strings.TrimSuffix(strings.TrimPrefix(value, "${"), "}")
		variable, fallback, _ = strings.Cut(contents, ":-")
	} else if strings.HasPrefix(value, "$") {
		variable = strings.TrimPrefix(value, "$")
	} else {
		fallback = value
	}
	if variable != "" && !validComposeVariable(variable) {
		return 0, "", false
	}
	if fallback == "" {
		return 0, variable, variable != ""
	}
	port, err := strconv.Atoi(fallback)
	if err != nil || port < 1 || port > 65535 {
		return 0, "", false
	}
	return port, variable, true
}

func validComposeVariable(value string) bool {
	for index, char := range value {
		if (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || char == '_' || (index > 0 && char >= '0' && char <= '9') {
			continue
		}
		return false
	}
	return value != ""
}

func composeDependencies(node yaml.Node) []string {
	values := make([]string, 0)
	switch node.Kind {
	case yaml.SequenceNode:
		for _, child := range node.Content {
			if child.Value != "" {
				values = append(values, child.Value)
			}
		}
	case yaml.MappingNode:
		for index := 0; index+1 < len(node.Content); index += 2 {
			if node.Content[index].Value != "" {
				values = append(values, node.Content[index].Value)
			}
		}
	}
	return values
}

func yamlMapValue(node yaml.Node, key string) string {
	for index := 0; index+1 < len(node.Content); index += 2 {
		if node.Content[index].Value == key {
			return node.Content[index+1].Value
		}
	}
	return ""
}

func repositoryServiceName(repository string) string {
	repository = strings.Trim(strings.TrimSpace(repository), "/")
	if index := strings.LastIndex(repository, "/"); index >= 0 {
		repository = repository[index+1:]
	}
	if repository == "" {
		return "service"
	}
	return repository
}

func detectedComposePath(contents []githubconnector.RepositoryContent) string {
	preferred := []string{"compose.coolify.yml", "docker-compose.yml", "compose.yml", "docker-compose.yaml", "compose.yaml"}
	byName := map[string]string{}
	for _, item := range contents {
		if item.Type == "file" {
			byName[item.Name] = item.Path
		}
	}
	for _, name := range preferred {
		if path, ok := byName[name]; ok {
			return path
		}
	}
	return ""
}

func (s Server) dispatchGitHubBuild(w http.ResponseWriter, r *http.Request) {
	if s.github.App == nil {
		writeError(w, validationError("github app is not configured"))
		return
	}
	connectorID, err := parseUUIDParam(r, "connectorID")
	if err != nil {
		writeError(w, err)
		return
	}
	var request githubBuildDispatchRequest
	if err := readJSON(w, r, &request); err != nil {
		writeError(w, err)
		return
	}
	request = normalizeGitHubBuildDispatchRequest(request)
	account, err := s.queries.GetConnectorAccount(r.Context(), connectorID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, notFoundError("connector not found"))
			return
		}
		writeError(w, err)
		return
	}
	if account.Provider != "github" || !account.Enabled {
		writeError(w, validationError("connector must be an enabled github connector"))
		return
	}
	repository, err := githubConnectorRepositoryForApplication(account.Config, request.Repository, request.Branch, request.ApplicationID)
	if err != nil {
		writeError(w, err)
		return
	}
	request = fillGitHubBuildDefaults(request, repository)
	expandGitHubBuildInputTemplates(request.Inputs, request.Inputs["commit_sha"])
	if err := validateGitHubBuildDispatchRequest(request); err != nil {
		writeError(w, err)
		return
	}
	if repository.InstallationID == "" {
		writeError(w, validationError("github repository requires installation_id before builds can be dispatched"))
		return
	}
	build, err := s.queries.CreateBuildRun(r.Context(), db.CreateBuildRunParams{
		Provider:      "github_actions",
		ConnectorID:   account.ID,
		ApplicationID: nullableApplicationID(repository.ApplicationID),
		Repository:    repository.Repository,
		Branch:        repository.Branch,
		WorkflowID:    request.WorkflowID,
		CommitSha:     blankStringAsText(request.Inputs["commit_sha"]),
	})
	if err != nil {
		writeError(w, err)
		return
	}
	inputs := githubBuildWorkflowInputs(request.Inputs, build)
	if err := s.github.App.DispatchWorkflow(r.Context(), repository.InstallationID, repository.Repository, request.WorkflowID, repository.Branch, inputs); err != nil {
		_, _ = s.queries.CompleteBuildRun(r.Context(), db.CompleteBuildRunParams{
			ID:           build.ID,
			Status:       "failed",
			ErrorMessage: blankStringAsText(buildErrorMessage(err)),
		})
		writeError(w, err)
		return
	}
	s.audit(r, "github.build_dispatch", "repository", repository.Repository, repository.Branch, map[string]any{
		"connector_id": uuidString(account.ID),
		"build_id":     uuidString(build.ID),
		"workflow_id":  request.WorkflowID,
		"provider":     "github_actions",
	})
	writeJSON(w, http.StatusAccepted, githubBuildDispatchResponse{Build: build})
}

func githubRepositoryResponses(account db.ConnectorAccount, raw []byte) []githubRepositoryResponse {
	items, err := githubconnector.RepositoriesFromConfig(raw)
	if err != nil {
		return nil
	}
	repositories := make([]githubRepositoryResponse, 0, len(items))
	for _, item := range items {
		repositories = append(repositories, githubRepositoryResponse{
			ConnectorID:     uuidString(account.ID),
			ConnectorName:   account.Name,
			InstallationID:  item.InstallationID,
			ApplicationID:   item.ApplicationID,
			ApplicationName: item.ApplicationName,
			Repository:      item.Repository,
			Branch:          item.Branch,
			WorkflowID:      item.WorkflowID,
			BuildContext:    item.BuildContext,
			Dockerfile:      item.Dockerfile,
			ImageRef:        item.ImageRef,
			BuildMatrix:     item.BuildMatrix,
			Runner:          item.Runner,
			PathFilters:     item.PathFilters,
			CloneURL:        "https://github.com/" + item.Repository + ".git",
			WebURL:          "https://github.com/" + item.Repository,
		})
	}
	return repositories
}

// githubConnectorRepository resolves a connector repository entry for the
// requested branch. The connector config stores one entry per repository and
// default branch; deploying from another branch reuses that entry with the
// branch overridden so users can pick any branch of a connected repository.
func githubConnectorRepository(raw []byte, repositoryName string, branch string) (githubconnector.Repository, error) {
	repositories, err := githubConnectorRepositories(raw, repositoryName, branch)
	if err == nil {
		return repositories[0], nil
	}
	repository, anyBranchErr := githubConnectorRepositoryAnyBranch(raw, repositoryName)
	if anyBranchErr != nil {
		return githubconnector.Repository{}, anyBranchErr
	}
	repository.Branch = branch
	return repository, nil
}

func githubConnectorRepositoryAnyBranch(raw []byte, repositoryName string) (githubconnector.Repository, error) {
	repositories, err := githubconnector.RepositoriesFromConfig(raw)
	if err != nil {
		return githubconnector.Repository{}, validationError("github connector config " + err.Error())
	}
	for _, repository := range repositories {
		if strings.EqualFold(repository.Repository, repositoryName) {
			return repository, nil
		}
	}
	return githubconnector.Repository{}, validationError("repository is not connected to this github connector")
}

func githubConnectorRepositoryForApplication(raw []byte, repositoryName string, branch string, applicationID string) (githubconnector.Repository, error) {
	repositories, err := githubConnectorRepositories(raw, repositoryName, branch)
	if err != nil {
		return githubconnector.Repository{}, err
	}
	applicationID = strings.TrimSpace(applicationID)
	if applicationID == "" && len(repositories) == 1 {
		return repositories[0], nil
	}
	for _, repository := range repositories {
		if applicationID != "" && repository.ApplicationID == applicationID {
			return repository, nil
		}
	}
	if applicationID == "" {
		return githubconnector.Repository{}, validationError("application_id is required when a repository has multiple build targets")
	}
	return githubconnector.Repository{}, validationError("repository build target is not connected to this application")
}

func githubConnectorRepositories(raw []byte, repositoryName string, branch string) ([]githubconnector.Repository, error) {
	repositories, err := githubconnector.RepositoriesFromConfig(raw)
	if err != nil {
		return nil, validationError("github connector config " + err.Error())
	}
	matches := make([]githubconnector.Repository, 0)
	for _, repository := range repositories {
		if strings.EqualFold(repository.Repository, repositoryName) && repository.Branch == branch {
			matches = append(matches, repository)
		}
	}
	if len(matches) == 0 {
		return nil, validationError("repository is not connected to this github connector")
	}
	return matches, nil
}

func normalizeGitHubBuildDispatchRequest(request githubBuildDispatchRequest) githubBuildDispatchRequest {
	request.Repository = strings.TrimSpace(request.Repository)
	request.ApplicationID = strings.TrimSpace(request.ApplicationID)
	request.Branch = strings.TrimSpace(request.Branch)
	request.WorkflowID = strings.TrimSpace(request.WorkflowID)
	if request.Branch == "" {
		request.Branch = "main"
	}
	return request
}

func fillGitHubBuildDefaults(request githubBuildDispatchRequest, repository githubconnector.Repository) githubBuildDispatchRequest {
	if request.WorkflowID == "" {
		request.WorkflowID = repository.WorkflowID
	}
	if request.WorkflowID == "" {
		request.WorkflowID = githubconnector.DefaultBuildWorkflowID
	}
	if request.Inputs == nil {
		request.Inputs = map[string]string{}
	}
	addGitHubBuildInput(request.Inputs, "image_ref", repository.ImageRef)
	addGitHubBuildInput(request.Inputs, "build_matrix", repository.BuildMatrix)
	if repository.BuildMatrix == "" {
		addGitHubBuildInput(request.Inputs, "build_context", repository.BuildContext)
		addGitHubBuildInput(request.Inputs, "dockerfile", repository.Dockerfile)
	}
	addGitHubBuildInput(request.Inputs, "runner", repository.Runner)
	return request
}

func expandGitHubBuildInputTemplates(inputs map[string]string, commitSHA string) {
	commitSHA = strings.TrimSpace(commitSHA)
	shortSHA := commitSHA
	if len(shortSHA) > 12 {
		shortSHA = shortSHA[:12]
	}
	for key, value := range inputs {
		value = strings.ReplaceAll(value, "${COMMIT_SHA}", commitSHA)
		value = strings.ReplaceAll(value, "${SHORT_SHA}", shortSHA)
		inputs[key] = value
	}
}

func addGitHubBuildInput(inputs map[string]string, key string, value string) {
	if strings.TrimSpace(inputs[key]) != "" || strings.TrimSpace(value) == "" {
		return
	}
	inputs[key] = strings.TrimSpace(value)
}

func validateGitHubBuildDispatchRequest(request githubBuildDispatchRequest) error {
	if request.Repository == "" {
		return validationError("repository is required")
	}
	if request.ApplicationID != "" && nullableApplicationID(request.ApplicationID).Valid == false {
		return validationError("application_id must be a uuid")
	}
	if strings.ContainsAny(request.WorkflowID, "/\\\r\n\t") {
		return validationError("workflow_id must be a workflow file name or numeric id")
	}
	if strings.TrimSpace(request.Inputs["image_ref"]) == "" {
		return validationError("image_ref is required before a github build can be dispatched")
	}
	for key, value := range request.Inputs {
		key = strings.TrimSpace(key)
		if key == "" || strings.ContainsAny(key, "\r\n\t") || strings.ContainsAny(value, "\r\n\t") {
			return validationError("workflow inputs cannot contain blank keys or control characters")
		}
	}
	return nil
}

func nullableApplicationID(value string) pgtype.UUID {
	id, err := stringutil.PgUUID(strings.TrimSpace(value))
	if err != nil {
		return pgtype.UUID{}
	}
	return id
}

func githubBuildWorkflowInputs(inputs map[string]string, build db.BuildRun) map[string]string {
	out := make(map[string]string, len(inputs)+3)
	for key, value := range inputs {
		out[key] = value
	}
	out["deploy_manager_build_id"] = uuidString(build.ID)
	out["repository"] = build.Repository
	out["branch"] = build.Branch
	return out
}

func buildErrorMessage(err error) string {
	message := errorString(err)
	if len(message) > 512 {
		return message[:512]
	}
	return message
}

func githubConfigFromInstallationRepositories(installationID string, repositories []githubconnector.AppRepository) ([]byte, error) {
	return githubConfigFromInstallationRepositoriesWithDefaults(installationID, repositories, nil)
}

func githubConfigFromInstallationRepositoriesWithDefaults(installationID string, repositories []githubconnector.AppRepository, existing []githubconnector.Repository) ([]byte, error) {
	type repositoryConfig struct {
		InstallationID  string   `json:"installation_id,omitempty"`
		ApplicationID   string   `json:"application_id,omitempty"`
		ApplicationName string   `json:"application_name,omitempty"`
		RepositoryID    string   `json:"repository_id,omitempty"`
		Repository      string   `json:"repository"`
		Branch          string   `json:"branch"`
		WorkflowID      string   `json:"workflow_id,omitempty"`
		BuildContext    string   `json:"build_context,omitempty"`
		Dockerfile      string   `json:"dockerfile,omitempty"`
		ImageRef        string   `json:"image_ref,omitempty"`
		BuildMatrix     string   `json:"build_matrix,omitempty"`
		Runner          string   `json:"runner,omitempty"`
		PathFilters     []string `json:"path_filters,omitempty"`
	}
	config := struct {
		InstallationID string             `json:"installation_id"`
		Repositories   []repositoryConfig `json:"repositories"`
	}{InstallationID: installationID}
	for _, repository := range repositories {
		fullName := repository.FullName
		if fullName == "" {
			continue
		}
		branch := repository.DefaultBranch
		if branch == "" {
			branch = "main"
		}
		preserved := false
		for _, previous := range existing {
			if previous.Repository != fullName {
				continue
			}
			previousBranch := previous.Branch
			if previousBranch == "" {
				previousBranch = branch
			}
			config.Repositories = append(config.Repositories, repositoryConfig{
				InstallationID:  installationID,
				RepositoryID:    strconv.FormatInt(repository.ID, 10),
				Repository:      fullName,
				Branch:          previousBranch,
				WorkflowID:      previous.WorkflowID,
				BuildContext:    previous.BuildContext,
				Dockerfile:      previous.Dockerfile,
				ImageRef:        previous.ImageRef,
				BuildMatrix:     previous.BuildMatrix,
				Runner:          previous.Runner,
				ApplicationID:   previous.ApplicationID,
				ApplicationName: previous.ApplicationName,
				PathFilters:     previous.PathFilters,
			})
			preserved = true
		}
		if !preserved {
			config.Repositories = append(config.Repositories, repositoryConfig{
				InstallationID: installationID,
				RepositoryID:   strconv.FormatInt(repository.ID, 10),
				Repository:     fullName,
				Branch:         branch,
			})
		}
	}
	if len(config.Repositories) == 0 {
		return nil, validationError("github installation did not return repositories")
	}
	return json.Marshal(config)
}
