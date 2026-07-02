package httpapi

import (
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"deploy-manager/internal/db"
	deploymentpkg "deploy-manager/internal/deployments"
	proxypkg "deploy-manager/internal/proxy"

	"github.com/jackc/pgx/v5"
)

var (
	githubSSHRepositoryURL   = regexp.MustCompile(`^git@github\.com:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git$`)
	githubHTTPSRepositoryURL = regexp.MustCompile(`^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?$`)
)

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
	if err := s.queries.DeleteApplication(r.Context(), applicationID); err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "application.delete", "application", uuidString(application.ID), application.Name, map[string]any{"environment_id": uuidString(application.EnvironmentID), "server_id": uuidString(application.ServerID)})
	w.WriteHeader(http.StatusNoContent)
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
