package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"deploy-manager/internal/db"
	deploymentpkg "deploy-manager/internal/deployments"
	proxypkg "deploy-manager/internal/proxy"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	githubSSHRepositoryURL   = regexp.MustCompile(`^git@github\.com:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git$`)
	githubHTTPSRepositoryURL = regexp.MustCompile(`^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?$`)
)

const applicationCleanupTimeout = 2 * time.Minute

const (
	executionModeFollowStack = "follow_stack"
	executionModeSingleton   = "singleton"
)

type updateApplicationRequest struct {
	db.UpdateApplicationParams
	ServiceExecutionModes map[string]string `json:"service_execution_modes"`
}

type applicationDeletionPlan struct {
	application    db.Application
	routes         []db.ListProxyRouteTargetsForApplicationRow
	hasDeployments bool
}

func (s Server) listApplications(w http.ResponseWriter, r *http.Request) {
	applications, err := s.queries.ListApplications(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, applications)
}

func (s Server) createApplication(w http.ResponseWriter, r *http.Request) {
	var input db.CreateApplicationParams
	if err := readJSON(w, r, &input); err != nil {
		writeError(w, err)
		return
	}
	input, err := normalizeCreateApplication(input)
	if err != nil {
		writeError(w, err)
		return
	}
	if _, err := s.queries.GetServer(r.Context(), input.ServerID); err != nil {
		writeError(w, applicationLookupError(err, "server not found"))
		return
	}
	if _, err := s.queries.GetEnvironment(r.Context(), input.EnvironmentID); err != nil {
		writeError(w, applicationLookupError(err, "environment not found"))
		return
	}
	application, err := s.queries.CreateApplication(r.Context(), input)
	if err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "application.create", "application", uuidString(application.ID), application.Name, map[string]any{"environment_id": uuidString(application.EnvironmentID), "server_id": uuidString(application.ServerID), "branch": application.Branch, "doppler_scoped": application.DopplerProject.Valid && application.DopplerConfig.Valid, "github_auto_deploy": application.GithubAutoDeploy})
	writeJSON(w, http.StatusCreated, application)
}

func (s Server) updateApplication(w http.ResponseWriter, r *http.Request) {
	applicationID, err := parseUUIDParam(r, "applicationID")
	if err != nil {
		writeError(w, err)
		return
	}
	var request updateApplicationRequest
	if err := readJSON(w, r, &request); err != nil {
		writeError(w, err)
		return
	}
	existing, err := s.queries.GetApplication(r.Context(), applicationID)
	if err != nil {
		writeError(w, applicationLookupError(err, "application not found"))
		return
	}
	input := request.UpdateApplicationParams
	input.ID = applicationID
	input.ComposeServices, err = mergeServiceExecutionModes(existing.ComposeServices, request.ServiceExecutionModes)
	if err != nil {
		writeError(w, err)
		return
	}
	input, err = normalizeUpdateApplication(input)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := validateApplicationServer(existing.ServerID, input.ServerID); err != nil {
		writeError(w, err)
		return
	}
	if _, err := s.queries.GetServer(r.Context(), input.ServerID); err != nil {
		writeError(w, applicationLookupError(err, "server not found"))
		return
	}
	if _, err := s.queries.GetEnvironment(r.Context(), input.EnvironmentID); err != nil {
		writeError(w, applicationLookupError(err, "environment not found"))
		return
	}
	application, err := s.queries.UpdateApplication(r.Context(), input)
	if err != nil {
		writeError(w, applicationLookupError(err, "application not found"))
		return
	}
	s.audit(r, "application.update", "application", uuidString(application.ID), application.Name, map[string]any{"environment_id": uuidString(application.EnvironmentID), "server_id": uuidString(application.ServerID), "branch": application.Branch, "doppler_scoped": application.DopplerProject.Valid && application.DopplerConfig.Valid, "github_auto_deploy": application.GithubAutoDeploy})
	writeJSON(w, http.StatusOK, application)
}

func (s Server) deleteApplication(w http.ResponseWriter, r *http.Request) {
	applicationID, err := parseUUIDParam(r, "applicationID")
	if err != nil {
		writeError(w, err)
		return
	}
	application, err := s.queries.GetApplication(r.Context(), applicationID)
	if err != nil {
		writeError(w, applicationLookupError(err, "application not found"))
		return
	}
	plan, err := s.prepareApplicationDeletion(r.Context(), application)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.cleanupApplication(r.Context(), plan); err != nil {
		writeError(w, err)
		return
	}
	tx, err := s.tx.Begin(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if err := deleteApplicationRecords(r.Context(), s.queries.WithTx(tx), plan); err != nil {
		writeError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "application.delete", "application", uuidString(application.ID), application.Name, map[string]any{"environment_id": uuidString(application.EnvironmentID), "server_id": uuidString(application.ServerID)})
	w.WriteHeader(http.StatusNoContent)
}

func (s Server) prepareApplicationDeletion(ctx context.Context, application db.Application) (applicationDeletionPlan, error) {
	state, err := s.queries.GetApplicationDeletionState(ctx, application.ID)
	if err != nil {
		return applicationDeletionPlan{}, err
	}
	if state.DeploymentInProgress {
		return applicationDeletionPlan{}, validationError("wait for or cancel the active deployment before deleting the service")
	}
	routes, err := s.queries.ListProxyRouteTargetsForApplication(ctx, db.ListProxyRouteTargetsForApplicationParams{
		ApplicationID: application.ID,
		ServerID:      application.ServerID,
	})
	if err != nil {
		return applicationDeletionPlan{}, err
	}
	return applicationDeletionPlan{application: application, routes: routes, hasDeployments: state.HasDeployments}, nil
}

func (s Server) cleanupApplication(ctx context.Context, plan applicationDeletionPlan) error {
	removeRoute := false
	for _, route := range plan.routes {
		removeRoute = removeRoute || route.Status != "pending"
	}
	if !plan.hasDeployments && !removeRoute {
		return nil
	}

	server, err := s.queries.GetServer(ctx, plan.application.ServerID)
	if err != nil {
		return fmt.Errorf("load server for service %q: %w", plan.application.Name, err)
	}
	cleanupCtx, cancel := context.WithTimeout(ctx, applicationCleanupTimeout)
	defer cancel()
	runner := s.remoteCommandRunner()

	if plan.hasDeployments {
		command, err := deploymentpkg.BuildComposeDownCommand(plan.application, plan.routes)
		if err != nil {
			return fmt.Errorf("prepare cleanup for service %q: %w", plan.application.Name, err)
		}
		if _, err := runner.Run(cleanupCtx, server, command); err != nil {
			return fmt.Errorf("stop service %q on server %q: %w", plan.application.Name, server.Name, err)
		}
	}
	for _, route := range plan.routes {
		if route.Status == "pending" {
			continue
		}
		command, err := proxypkg.BuildRemoveCommand(route.Domain, route.ProxyType)
		if err != nil {
			return fmt.Errorf("prepare domain cleanup for %q: %w", route.Domain, err)
		}
		if _, err := runner.Run(cleanupCtx, server, command); err != nil {
			return fmt.Errorf("remove domain %q from server %q: %w", route.Domain, server.Name, err)
		}
	}
	return nil
}

func deleteApplicationRecords(ctx context.Context, queries *db.Queries, plan applicationDeletionPlan) error {
	for _, route := range plan.routes {
		if err := queries.DeleteProxyRoute(ctx, route.ID); err != nil {
			return err
		}
	}
	return queries.DeleteApplication(ctx, plan.application.ID)
}

func normalizeCreateApplication(input db.CreateApplicationParams) (db.CreateApplicationParams, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Branch = strings.TrimSpace(input.Branch)
	input.ComposePath = strings.TrimSpace(input.ComposePath)
	input.RemoteDirectory = strings.TrimSpace(input.RemoteDirectory)
	input.RepositoryUrl.String = strings.TrimSpace(input.RepositoryUrl.String)
	input.Domain.String = strings.ToLower(strings.TrimSpace(input.Domain.String))
	input.HealthCheckUrl.String = strings.TrimSpace(input.HealthCheckUrl.String)
	input.DopplerProject.String = strings.TrimSpace(input.DopplerProject.String)
	input.DopplerConfig.String = strings.TrimSpace(input.DopplerConfig.String)

	if !input.EnvironmentID.Valid || !input.ServerID.Valid || input.Name == "" || input.RemoteDirectory == "" {
		return input, validationError("environment_id, server_id, name, and remote_directory are required")
	}
	if err := validateRemoteDirectory(input.RemoteDirectory); err != nil {
		return input, validationError(err.Error())
	}
	if input.Branch == "" {
		input.Branch = "main"
	}
	if err := deploymentpkg.ValidateGitRefName(input.Branch); err != nil {
		return input, validationError(err.Error())
	}
	if input.ComposePath == "" {
		input.ComposePath = "docker-compose.yml"
	}
	if err := deploymentpkg.ValidateComposePath(input.ComposePath); err != nil {
		return input, validationError(err.Error())
	}
	input.RepositoryUrl = blankTextAsNull(input.RepositoryUrl)
	if input.RepositoryUrl.Valid {
		if err := validateRepositoryURL(input.RepositoryUrl.String); err != nil {
			return input, validationError(err.Error())
		}
	}
	input.Domain = blankTextAsNull(input.Domain)
	if input.Domain.Valid {
		if err := proxypkg.ValidateDomain(input.Domain.String); err != nil {
			return input, validationError(err.Error())
		}
	}
	input.HealthCheckUrl = blankTextAsNull(input.HealthCheckUrl)
	if input.HealthCheckUrl.Valid {
		if err := validateHealthCheckURL(input.HealthCheckUrl.String); err != nil {
			return input, validationError(err.Error())
		}
	}
	input.DopplerProject = blankTextAsNull(input.DopplerProject)
	input.DopplerConfig = blankTextAsNull(input.DopplerConfig)
	if input.DopplerProject.Valid != input.DopplerConfig.Valid {
		return input, validationError("doppler project and config must be provided together")
	}
	if input.DopplerProject.Valid {
		if err := validateDopplerScopeValue("doppler project", input.DopplerProject.String); err != nil {
			return input, validationError(err.Error())
		}
		if err := validateDopplerScopeValue("doppler config", input.DopplerConfig.String); err != nil {
			return input, validationError(err.Error())
		}
	}
	return input, nil
}

func normalizeUpdateApplication(input db.UpdateApplicationParams) (db.UpdateApplicationParams, error) {
	createInput, err := normalizeCreateApplication(db.CreateApplicationParams{
		EnvironmentID:    input.EnvironmentID,
		ServerID:         input.ServerID,
		Name:             input.Name,
		RepositoryUrl:    input.RepositoryUrl,
		Branch:           input.Branch,
		ComposePath:      input.ComposePath,
		RemoteDirectory:  input.RemoteDirectory,
		Domain:           input.Domain,
		HealthCheckUrl:   input.HealthCheckUrl,
		DopplerProject:   input.DopplerProject,
		DopplerConfig:    input.DopplerConfig,
		GithubAutoDeploy: input.GithubAutoDeploy,
	})
	if err != nil {
		return input, err
	}
	input.EnvironmentID = createInput.EnvironmentID
	input.ServerID = createInput.ServerID
	input.Name = createInput.Name
	input.RepositoryUrl = createInput.RepositoryUrl
	input.Branch = createInput.Branch
	input.ComposePath = createInput.ComposePath
	input.RemoteDirectory = createInput.RemoteDirectory
	input.Domain = createInput.Domain
	input.HealthCheckUrl = createInput.HealthCheckUrl
	input.DopplerProject = createInput.DopplerProject
	input.DopplerConfig = createInput.DopplerConfig
	input.GithubAutoDeploy = createInput.GithubAutoDeploy
	if len(input.ComposeServices) == 0 {
		input.ComposeServices = []byte("[]")
	}
	return input, nil
}

func mergeServiceExecutionModes(metadata []byte, requested map[string]string) ([]byte, error) {
	services := []githubComposeService{}
	if len(metadata) > 0 && json.Unmarshal(metadata, &services) != nil {
		return nil, validationError("compose service metadata is invalid")
	}
	known := make(map[string]bool, len(services))
	for index := range services {
		known[services[index].Name] = true
		mode := strings.TrimSpace(services[index].ExecutionMode)
		if requestedMode, ok := requested[services[index].Name]; ok {
			mode = strings.TrimSpace(requestedMode)
		}
		if mode == "" {
			mode = executionModeFollowStack
		}
		if !validServiceExecutionMode(mode) {
			return nil, validationError("service execution mode must be follow_stack or singleton")
		}
		services[index].ExecutionMode = mode
	}
	for service := range requested {
		if !known[service] {
			return nil, validationError("unknown compose service " + service)
		}
	}
	return json.Marshal(services)
}

func validServiceExecutionMode(mode string) bool {
	return mode == executionModeFollowStack || mode == executionModeSingleton
}

func validateApplicationServer(existing, requested pgtype.UUID) error {
	if existing != requested {
		return validationError("server_id cannot be changed; recreate the service on another server")
	}
	return nil
}

func applicationLookupError(err error, message string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return notFoundError(message)
	}
	return err
}

func validateRemoteDirectory(value string) error {
	if strings.ContainsAny(value, "\r\n\t") {
		return validationError("remote_directory cannot contain control characters")
	}
	if value == "/" || !strings.HasPrefix(value, "/") {
		return validationError("remote_directory must be an absolute path below root")
	}
	if strings.Contains(value, "//") {
		return validationError("remote_directory cannot contain empty path segments")
	}
	for _, segment := range strings.Split(value, "/") {
		if segment == ".." {
			return validationError("remote_directory cannot contain parent directory segments")
		}
	}
	return nil
}

func validateRepositoryURL(value string) error {
	if strings.ContainsAny(value, "\r\n\t") {
		return validationError("repository_url cannot contain control characters")
	}
	if githubSSHRepositoryURL.MatchString(value) {
		return nil
	}

	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" {
		return validationError("repository_url must be a GitHub SSH URL or GitHub https URL")
	}
	if parsed.Scheme != "https" {
		return validationError("repository_url must use https for HTTP remotes")
	}
	if parsed.User != nil {
		return validationError("repository_url cannot include credentials")
	}
	if !githubHTTPSRepositoryURL.MatchString(value) {
		return validationError("repository_url must point to github.com owner/repository")
	}
	return nil
}

func validateHealthCheckURL(value string) error {
	if strings.ContainsAny(value, "\r\n\t") {
		return validationError("health_check_url cannot contain control characters")
	}

	value = strings.ReplaceAll(value, "{color}", "blue")
	value = strings.ReplaceAll(value, "{port}", "3101")
	parsed, err := url.Parse(value)
	if err != nil {
		return err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return validationError("health_check_url must use http or https")
	}
	if parsed.Host == "" {
		return validationError("health_check_url must include a host")
	}
	if parsed.User != nil {
		return validationError("health_check_url cannot include credentials")
	}
	return nil
}

func validateDopplerScopeValue(field string, value string) error {
	if strings.ContainsAny(value, "\r\n\t") {
		return validationError(field + " cannot contain control characters")
	}
	return nil
}
