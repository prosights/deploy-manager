package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"deploy-manager/internal/db"
	"deploy-manager/internal/githubconnector"
	"deploy-manager/internal/stringutil"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
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
	Name        string                `json:"name"`
	Root        string                `json:"root"`
	ComposePath string                `json:"compose_path"`
	PathFilters []string              `json:"path_filters"`
	Images      []githubDetectedImage `json:"images"`
}

type githubDetectedImage struct {
	Name         string `json:"name"`
	ImageRef     string `json:"image_ref"`
	BuildContext string `json:"build_context"`
	Dockerfile   string `json:"dockerfile"`
}

type githubDetectServicesResponse struct {
	Repository string                  `json:"repository"`
	Branch     string                  `json:"branch"`
	Services   []githubDetectedService `json:"services"`
}

type githubImportServicesRequest struct {
	ConnectorID   string   `json:"connector_id"`
	Repository    string   `json:"repository"`
	Branch        string   `json:"branch"`
	EnvironmentID string   `json:"environment_id"`
	ServerID      string   `json:"server_id"`
	Services      []string `json:"services"`
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
	services, err := s.detectRepositoryServices(r, repository)
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
	if !project.DefaultRegistryID.Valid {
		writeError(w, validationError("configure the project registry before importing GitHub services"))
		return
	}
	registry, err := s.queries.GetContainerRegistry(r.Context(), project.DefaultRegistryID)
	if err != nil {
		writeError(w, err)
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
	services, err := s.detectRepositoryServices(r, repository)
	if err != nil {
		writeError(w, err)
		return
	}
	selected := selectedServiceNames(request.Services)
	applications := make([]db.Application, 0, len(services))
	targets := make([]githubconnector.Repository, 0, len(services))
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
			RemoteDirectory:  "/srv/deploy-manager/apps/" + environment.Slug + "/" + service.Name,
			HealthCheckUrl:   blankStringAsText("http://127.0.0.1:{port}/healthz"),
			GithubAutoDeploy: true,
		})
		if err != nil {
			writeError(w, err)
			return
		}
		app, err := s.queries.CreateApplication(r.Context(), input)
		if err != nil {
			writeError(w, err)
			return
		}
		applications = append(applications, app)
		targets = append(targets, githubBuildTargetForService(repository, app, service, registry))
	}
	if len(applications) == 0 {
		writeError(w, validationError("no detected services selected"))
		return
	}
	config, err := githubConfigWithBuildTargets(account.Config, targets)
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

func githubBuildTargetForService(repository githubconnector.Repository, app db.Application, service githubDetectedService, registry db.ContainerRegistry) githubconnector.Repository {
	images := service.Images
	for index := range images {
		images[index].ImageRef = registryImageRef(registry, images[index].Name)
	}
	matrix, _ := json.Marshal(images)
	target := repository
	target.ApplicationID = uuidString(app.ID)
	target.ApplicationName = app.Name
	target.WorkflowID = "deploy-manager-monorepo-gar.yml"
	target.PathFilters = service.PathFilters
	target.BuildMatrix = string(matrix)
	target.BuildContext = service.Root
	target.Dockerfile = service.Images[0].Dockerfile
	target.ImageRef = images[0].ImageRef
	if target.Runner == "" || target.Runner == "ubuntu-latest" {
		target.Runner = "linux_32_core"
	}
	return target
}

func registryImageRef(registry db.ContainerRegistry, imageName string) string {
	parts := []string{registry.RegistryHost, registry.Namespace, registry.Repository, imageName}
	cleaned := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.Trim(strings.TrimSpace(part), "/")
		if part != "" {
			cleaned = append(cleaned, part)
		}
	}
	return strings.Join(cleaned, "/") + ":sha-${SHORT_SHA}"
}

func githubConfigWithBuildTargets(raw []byte, targets []githubconnector.Repository) ([]byte, error) {
	cfg, err := githubconnector.ParseConfig(raw)
	if err != nil {
		return nil, validationError("github connector config " + err.Error())
	}
	repositories := make([]githubconnector.Repository, 0, len(cfg.Repositories)+len(targets))
	for _, existing := range cfg.Repositories {
		replace := false
		for _, target := range targets {
			if strings.EqualFold(existing.Repository, target.Repository) && existing.Branch == target.Branch {
				if existing.ApplicationID == "" && existing.ApplicationName == "" {
					replace = true
					break
				}
				if existing.ApplicationID == target.ApplicationID || (existing.ApplicationName != "" && strings.EqualFold(existing.ApplicationName, target.ApplicationName)) {
					replace = true
					break
				}
			}
		}
		if !replace {
			repositories = append(repositories, existing)
		}
	}
	repositories = append(repositories, targets...)
	config := struct {
		InstallationID string                       `json:"installation_id,omitempty"`
		Repositories   []githubconnector.Repository `json:"repositories"`
	}{InstallationID: cfg.InstallationID, Repositories: repositories}
	return json.Marshal(config)
}

func (s Server) detectRepositoryServices(r *http.Request, repository githubconnector.Repository) ([]githubDetectedService, error) {
	root, err := s.github.App.ListRepositoryContents(r.Context(), repository.InstallationID, repository.Repository, "", repository.Branch)
	if err != nil {
		return nil, err
	}
	services := make([]githubDetectedService, 0)
	for _, item := range root {
		if item.Type != "dir" || item.Name == "" {
			continue
		}
		children, err := s.github.App.ListRepositoryContents(r.Context(), repository.InstallationID, repository.Repository, item.Path, repository.Branch)
		if err != nil {
			continue
		}
		if composePath := detectedComposePath(children); composePath != "" {
			services = append(services, githubDetectedService{
				Name:        item.Name,
				Root:        item.Path,
				ComposePath: composePath,
				PathFilters: []string{item.Path + "/**"},
				Images:      s.detectServiceImages(r, repository, item.Path, children, ""),
			})
		}
	}
	return services, nil
}

func (s Server) detectServiceImages(r *http.Request, repository githubconnector.Repository, root string, contents []githubconnector.RepositoryContent, imageBase string) []githubDetectedImage {
	images := make([]githubDetectedImage, 0)
	for _, item := range contents {
		if item.Type == "file" && item.Name == "Dockerfile" {
			name := strings.Trim(strings.ReplaceAll(root, "/", "-"), "-")
			if imageBase != "" {
				name = imageBase
			}
			images = append(images, githubDetectedImage{Name: name, BuildContext: root, Dockerfile: item.Path})
			continue
		}
		if item.Type != "dir" {
			continue
		}
		children, err := s.github.App.ListRepositoryContents(r.Context(), repository.InstallationID, repository.Repository, item.Path, repository.Branch)
		if err != nil {
			continue
		}
		for _, child := range children {
			if child.Type == "file" && child.Name == "Dockerfile" {
				name := strings.Trim(strings.ReplaceAll(item.Path, "/", "-"), "-")
				images = append(images, githubDetectedImage{Name: name, BuildContext: root, Dockerfile: child.Path})
				break
			}
		}
	}
	if len(images) == 0 {
		name := strings.Trim(strings.ReplaceAll(root, "/", "-"), "-")
		images = append(images, githubDetectedImage{Name: name, BuildContext: root, Dockerfile: root + "/Dockerfile"})
	}
	return images
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

func githubConnectorRepository(raw []byte, repositoryName string, branch string) (githubconnector.Repository, error) {
	repositories, err := githubConnectorRepositories(raw, repositoryName, branch)
	if err != nil {
		return githubconnector.Repository{}, err
	}
	return repositories[0], nil
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
	addGitHubBuildInput(request.Inputs, "build_context", repository.BuildContext)
	addGitHubBuildInput(request.Inputs, "dockerfile", repository.Dockerfile)
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
	defaults := githubRepositoryBuildDefaults(existing)
	for _, repository := range repositories {
		fullName := repository.FullName
		if fullName == "" {
			continue
		}
		branch := repository.DefaultBranch
		if branch == "" {
			branch = "main"
		}
		item := repositoryConfig{
			InstallationID: installationID,
			RepositoryID:   strconv.FormatInt(repository.ID, 10),
			Repository:     fullName,
			Branch:         branch,
		}
		if previous, ok := defaults[fullName+"#"+branch]; ok {
			item.WorkflowID = previous.WorkflowID
			item.BuildContext = previous.BuildContext
			item.Dockerfile = previous.Dockerfile
			item.ImageRef = previous.ImageRef
			item.BuildMatrix = previous.BuildMatrix
			item.Runner = previous.Runner
			item.ApplicationID = previous.ApplicationID
			item.ApplicationName = previous.ApplicationName
			item.PathFilters = previous.PathFilters
		}
		config.Repositories = append(config.Repositories, item)
	}
	if len(config.Repositories) == 0 {
		return nil, validationError("github installation did not return repositories")
	}
	return json.Marshal(config)
}

func githubRepositoryBuildDefaults(repositories []githubconnector.Repository) map[string]githubconnector.Repository {
	defaults := make(map[string]githubconnector.Repository, len(repositories))
	for _, repository := range repositories {
		key := repository.Repository + "#" + repository.Branch
		defaults[key] = repository
	}
	return defaults
}
