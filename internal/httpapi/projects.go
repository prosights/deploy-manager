package httpapi

import (
	"net/http"
	"regexp"
	"strings"

	"deploy-manager/internal/db"

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
