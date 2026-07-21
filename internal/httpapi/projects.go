package httpapi

import (
	"errors"
	"net/http"
	"regexp"
	"strings"

	"deploy-manager/internal/db"
	deploymentpkg "deploy-manager/internal/deployments"
	"deploy-manager/internal/stringutil"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var slugPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`)

func (s Server) listProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := s.queries.ListProjects(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

func (s Server) createProject(w http.ResponseWriter, r *http.Request) {
	var input db.CreateProjectWithDefaultEnvironmentsParams
	if err := readJSON(w, r, &input); err != nil {
		writeError(w, err)
		return
	}
	input, err := normalizeCreateProject(input)
	if err != nil {
		writeError(w, err)
		return
	}

	project, err := s.queries.CreateProjectWithDefaultEnvironments(r.Context(), input)
	if err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "project.create", "project", uuidString(project.ID), project.Name, map[string]any{"slug": project.Slug})
	writeJSON(w, http.StatusCreated, project)
}

func (s Server) updateProject(w http.ResponseWriter, r *http.Request) {
	projectID, err := parseUUIDParam(r, "projectID")
	if err != nil {
		writeError(w, err)
		return
	}
	var request db.UpdateProjectParams
	if err := readJSON(w, r, &request); err != nil {
		writeError(w, err)
		return
	}
	request.ID = projectID
	request, err = normalizeUpdateProject(request)
	if err != nil {
		writeError(w, err)
		return
	}
	project, err := s.queries.UpdateProject(r.Context(), request)
	if err != nil {
		writeError(w, applicationLookupError(err, "project not found"))
		return
	}
	s.audit(r, "project.update", "project", uuidString(project.ID), project.Name, map[string]any{"slug": project.Slug})
	writeJSON(w, http.StatusOK, project)
}

func (s Server) deleteProject(w http.ResponseWriter, r *http.Request) {
	projectID, err := parseUUIDParam(r, "projectID")
	if err != nil {
		writeError(w, err)
		return
	}
	project, err := s.queries.GetProject(r.Context(), projectID)
	if err != nil {
		writeError(w, applicationLookupError(err, "project not found"))
		return
	}
	applications, err := s.queries.ListApplications(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	for _, listed := range applications {
		if listed.ProjectID == projectID {
			writeError(w, validationError("delete every service in this project before deleting the project"))
			return
		}
	}
	if err := s.queries.DeleteProject(r.Context(), projectID); err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "project.delete", "project", uuidString(project.ID), project.Name, map[string]any{"slug": project.Slug})
	w.WriteHeader(http.StatusNoContent)
}

func (s Server) updateProjectRegistry(w http.ResponseWriter, r *http.Request) {
	projectID, err := parseUUIDParam(r, "projectID")
	if err != nil {
		writeError(w, err)
		return
	}
	var request updateProjectRegistryRequest
	if err := readJSON(w, r, &request); err != nil {
		writeError(w, err)
		return
	}
	if request.DefaultRegistryID.Valid {
		if _, err := s.queries.GetContainerRegistry(r.Context(), request.DefaultRegistryID); err != nil {
			writeError(w, applicationLookupError(err, "registry not found"))
			return
		}
	}
	project, err := s.queries.UpdateProjectRegistry(r.Context(), db.UpdateProjectRegistryParams{
		ID:                projectID,
		DefaultRegistryID: request.DefaultRegistryID,
	})
	if err != nil {
		writeError(w, applicationLookupError(err, "project not found"))
		return
	}
	s.audit(r, "project.registry_update", "project", uuidString(project.ID), project.Name, map[string]any{"registry_configured": project.DefaultRegistryID.Valid})
	writeJSON(w, http.StatusOK, project)
}

type updateProjectRegistryRequest struct {
	DefaultRegistryID pgtype.UUID `json:"default_registry_id"`
}

type updateProjectRepositoryRequest struct {
	ConnectorID string `json:"connector_id"`
	Repository  string `json:"repository"`
	Branch      string `json:"branch"`
}

// updateProjectRepository connects a project to one GitHub repository and
// branch, or disconnects it when repository is blank. Services imported into
// the project deploy from this source.
func (s Server) updateProjectRepository(w http.ResponseWriter, r *http.Request) {
	projectID, err := parseUUIDParam(r, "projectID")
	if err != nil {
		writeError(w, err)
		return
	}
	var request updateProjectRepositoryRequest
	if err := readJSON(w, r, &request); err != nil {
		writeError(w, err)
		return
	}
	request.ConnectorID = strings.TrimSpace(request.ConnectorID)
	request.Repository = strings.TrimSpace(request.Repository)
	request.Branch = strings.TrimSpace(request.Branch)

	params := db.UpdateProjectRepositoryParams{ID: projectID}
	if request.Repository != "" {
		connectorID, err := stringutil.PgUUID(request.ConnectorID)
		if err != nil {
			writeError(w, validationError("connector_id must be a uuid"))
			return
		}
		account, err := s.queries.GetConnectorAccount(r.Context(), connectorID)
		if err != nil {
			writeError(w, applicationLookupError(err, "connector not found"))
			return
		}
		if account.Provider != "github" || !account.Enabled {
			writeError(w, validationError("connector must be an enabled github connector"))
			return
		}
		repository, err := githubConnectorRepositoryAnyBranch(account.Config, request.Repository)
		if err != nil {
			writeError(w, err)
			return
		}
		if request.Branch == "" {
			request.Branch = repository.Branch
		}
		if request.Branch == "" {
			request.Branch = "main"
		}
		if err := deploymentpkg.ValidateGitRefName(request.Branch); err != nil {
			writeError(w, validationError("branch "+err.Error()))
			return
		}
		params.RepositoryConnectorID = connectorID
		params.RepositoryFullName = blankStringAsText(repository.Repository)
		params.RepositoryBranch = blankStringAsText(request.Branch)
	}
	project, err := s.queries.UpdateProjectRepository(r.Context(), params)
	if err != nil {
		writeError(w, applicationLookupError(err, "project not found"))
		return
	}
	s.audit(r, "project.repository_update", "project", uuidString(project.ID), project.Name, map[string]any{
		"repository": project.RepositoryFullName.String,
		"branch":     project.RepositoryBranch.String,
		"connected":  project.RepositoryFullName.Valid,
	})
	writeJSON(w, http.StatusOK, project)
}

func (s Server) listEnvironments(w http.ResponseWriter, r *http.Request) {
	environments, err := s.queries.ListEnvironments(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, environments)
}

func (s Server) createEnvironment(w http.ResponseWriter, r *http.Request) {
	var input db.CreateEnvironmentParams
	if err := readJSON(w, r, &input); err != nil {
		writeError(w, err)
		return
	}
	input, err := normalizeCreateEnvironment(input)
	if err != nil {
		writeError(w, err)
		return
	}
	if _, err := s.queries.GetProject(r.Context(), input.ProjectID); err != nil {
		writeError(w, applicationLookupError(err, "project not found"))
		return
	}

	environment, err := s.queries.CreateEnvironment(r.Context(), input)
	if err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "environment.create", "environment", uuidString(environment.ID), environment.Name, map[string]any{"project_id": uuidString(environment.ProjectID), "kind": environment.Kind, "ephemeral": environment.IsEphemeral})
	writeJSON(w, http.StatusCreated, environment)
}

func (s Server) deleteEnvironment(w http.ResponseWriter, r *http.Request) {
	environmentID, err := parseUUIDParam(r, "environmentID")
	if err != nil {
		writeError(w, err)
		return
	}
	environment, err := s.queries.GetEnvironment(r.Context(), environmentID)
	if err != nil {
		writeError(w, applicationLookupError(err, "environment not found"))
		return
	}
	if environment.Kind == "production" {
		writeError(w, validationError("the production environment cannot be deleted"))
		return
	}
	if _, err := s.queries.DeleteEnvironment(r.Context(), environmentID); err != nil {
		writeError(w, environmentDeletionError(err))
		return
	}
	s.audit(r, "environment.delete", "environment", uuidString(environment.ID), environment.Name, map[string]any{"project_id": uuidString(environment.ProjectID), "kind": environment.Kind})
	w.WriteHeader(http.StatusNoContent)
}

func environmentDeletionError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return validationError("remove all services before deleting the environment")
	}
	return err
}

func normalizeCreateProject(input db.CreateProjectWithDefaultEnvironmentsParams) (db.CreateProjectWithDefaultEnvironmentsParams, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Slug = normalizeSlug(input.Slug)
	input.Description = strings.TrimSpace(input.Description)
	if input.Name == "" || input.Slug == "" {
		return input, validationError("name and slug are required")
	}
	if hasProjectControlCharacters(input.Name, input.Description) {
		return input, validationError("project text fields cannot contain control characters")
	}
	if !slugPattern.MatchString(input.Slug) {
		return input, validationError("slug must use lowercase letters, numbers, and hyphens")
	}
	return input, nil
}

func normalizeUpdateProject(input db.UpdateProjectParams) (db.UpdateProjectParams, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Slug = normalizeSlug(input.Slug)
	input.Description = strings.TrimSpace(input.Description)
	if input.Name == "" || input.Slug == "" {
		return input, validationError("name and slug are required")
	}
	if hasProjectControlCharacters(input.Name, input.Description) {
		return input, validationError("project text fields cannot contain control characters")
	}
	if !slugPattern.MatchString(input.Slug) {
		return input, validationError("slug must use lowercase letters, numbers, and hyphens")
	}
	return input, nil
}

func normalizeCreateEnvironment(input db.CreateEnvironmentParams) (db.CreateEnvironmentParams, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Slug = normalizeSlug(input.Slug)
	input.Kind = strings.TrimSpace(input.Kind)
	input.Branch.String = strings.TrimSpace(input.Branch.String)
	if input.Kind == "" {
		input.Kind = "development"
	}
	if !input.ProjectID.Valid || input.Name == "" || input.Slug == "" {
		return input, validationError("project_id, name, and slug are required")
	}
	if hasProjectControlCharacters(input.Name, input.Branch.String) {
		return input, validationError("environment fields cannot contain control characters")
	}
	if !slugPattern.MatchString(input.Slug) {
		return input, validationError("slug must use lowercase letters, numbers, and hyphens")
	}
	switch input.Kind {
	case "production", "development":
		input.IsEphemeral = false
		input.PullRequestNumber = pgtype.Int4{}
		input.ExpiresAt = pgtype.Timestamptz{}
	case "preview":
		input.IsEphemeral = true
		if input.PullRequestNumber.Valid && input.PullRequestNumber.Int32 <= 0 {
			return input, validationError("pull_request_number must be greater than zero")
		}
	default:
		return input, validationError("environment kind must be production, development, or preview")
	}
	input.Branch = blankTextAsNull(input.Branch)
	return input, nil
}

func normalizeSlug(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func hasProjectControlCharacters(values ...string) bool {
	for _, value := range values {
		if strings.ContainsAny(value, "\r\n\t") {
			return true
		}
	}
	return false
}
