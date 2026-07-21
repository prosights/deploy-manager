package httpapi

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"unicode"

	"deploy-manager/internal/connectors"
	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5/pgtype"
)

const (
	maxProjectRuntimeVariables       = 256
	maxProjectRuntimeVariableKey     = 128
	maxProjectRuntimeVariableValue   = 8192
	maxProjectRuntimeEnvironmentSize = 65536
)

type projectRuntimeVariableInput struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type projectRuntimeVariablesRequest struct {
	Variables []projectRuntimeVariableInput `json:"variables"`
}

type projectRuntimeVariablesResponse struct {
	Variables             []projectRuntimeVariableInput `json:"variables"`
	ConfigurationRevision int64                         `json:"configuration_revision"`
	Changed               bool                          `json:"changed"`
}

func (s Server) listProjectRuntimeVariables(w http.ResponseWriter, r *http.Request) {
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
	variables, err := s.queries.ListProjectRuntimeVariables(r.Context(), projectID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, projectRuntimeVariablesResponse{
		Variables:             projectRuntimeVariableInputs(variables),
		ConfigurationRevision: project.ConfigurationRevision,
	})
}

func (s Server) replaceProjectRuntimeVariables(w http.ResponseWriter, r *http.Request) {
	projectID, err := parseUUIDParam(r, "projectID")
	if err != nil {
		writeError(w, err)
		return
	}
	var request projectRuntimeVariablesRequest
	if err := readJSON(w, r, &request); err != nil {
		writeError(w, err)
		return
	}
	variables, err := normalizeProjectRuntimeVariables(request.Variables)
	if err != nil {
		writeError(w, err)
		return
	}

	project, changed, err := s.storeProjectRuntimeVariables(r.Context(), projectID, variables)
	if err != nil {
		writeError(w, err)
		return
	}
	if changed {
		s.audit(r, "project.variables_update", "project", uuidString(project.ID), project.Name, map[string]any{
			"configuration_revision": project.ConfigurationRevision,
			"variable_count":         len(variables),
		})
	}
	writeJSON(w, http.StatusOK, projectRuntimeVariablesResponse{
		Variables:             variables,
		ConfigurationRevision: project.ConfigurationRevision,
		Changed:               changed,
	})
}

func (s Server) storeProjectRuntimeVariables(ctx context.Context, projectID pgtype.UUID, variables []projectRuntimeVariableInput) (db.Project, bool, error) {
	tx, err := s.tx.Begin(ctx)
	if err != nil {
		return db.Project{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	queries := s.queries.WithTx(tx)
	project, err := queries.GetProjectForUpdate(ctx, projectID)
	if err != nil {
		return db.Project{}, false, applicationLookupError(err, "project not found")
	}
	existing, err := queries.ListProjectRuntimeVariables(ctx, projectID)
	if err != nil {
		return db.Project{}, false, err
	}
	if projectRuntimeVariablesEqual(existing, variables) {
		if err := tx.Commit(ctx); err != nil {
			return db.Project{}, false, err
		}
		return project, false, nil
	}

	if err := queries.DeleteProjectRuntimeVariables(ctx, projectID); err != nil {
		return db.Project{}, false, err
	}
	for _, variable := range variables {
		if _, err := queries.UpsertProjectRuntimeVariable(ctx, db.UpsertProjectRuntimeVariableParams{
			ProjectID: projectID,
			Key:       variable.Key,
			Value:     variable.Value,
		}); err != nil {
			return db.Project{}, false, err
		}
	}
	project.ConfigurationRevision, err = queries.IncrementProjectConfigurationRevision(ctx, projectID)
	if err != nil {
		return db.Project{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Project{}, false, err
	}
	return project, true, nil
}

func normalizeProjectRuntimeVariables(variables []projectRuntimeVariableInput) ([]projectRuntimeVariableInput, error) {
	if len(variables) > maxProjectRuntimeVariables {
		return nil, validationError("project runtime variables cannot exceed 256 entries")
	}
	normalized := make([]projectRuntimeVariableInput, 0, len(variables))
	seen := make(map[string]struct{}, len(variables))
	environmentSize := 0
	for _, variable := range variables {
		variable.Key = strings.TrimSpace(variable.Key)
		if variable.Key == "" {
			return nil, validationError("project runtime variable key is required")
		}
		if len(variable.Key) > maxProjectRuntimeVariableKey || !connectors.ValidRuntimeVariableKey(variable.Key) {
			return nil, validationError("project runtime variable keys must start with a letter or underscore and contain only letters, numbers, and underscores")
		}
		if _, duplicate := seen[variable.Key]; duplicate {
			return nil, validationError("project runtime variable keys must be unique")
		}
		if isSecretConfigKey(variable.Key) {
			return nil, validationError("project runtime variables cannot contain secret-like keys; store secrets in Doppler")
		}
		if reservedProjectRuntimeVariable(variable.Key) {
			return nil, validationError("project runtime variable key is reserved by the deployment runtime")
		}
		if len(variable.Value) > maxProjectRuntimeVariableValue {
			return nil, validationError("project runtime variable values cannot exceed 8192 bytes")
		}
		if containsControlCharacter(variable.Value) {
			return nil, validationError("project runtime variable values cannot contain control characters")
		}
		if looksLikeSecretMaterial(variable.Value) {
			return nil, validationError("project runtime variables cannot contain raw secret material; store secrets in Doppler")
		}
		seen[variable.Key] = struct{}{}
		environmentSize += renderedRuntimeVariableSize(variable)
		normalized = append(normalized, variable)
	}
	if environmentSize > maxProjectRuntimeEnvironmentSize {
		return nil, validationError("project runtime variables cannot exceed 65536 bytes when rendered")
	}
	sort.Slice(normalized, func(i, j int) bool { return normalized[i].Key < normalized[j].Key })
	return normalized, nil
}

func projectRuntimeVariablesEqual(existing []db.ProjectRuntimeVariable, requested []projectRuntimeVariableInput) bool {
	if len(existing) != len(requested) {
		return false
	}
	for index := range existing {
		if existing[index].Key != requested[index].Key || existing[index].Value != requested[index].Value {
			return false
		}
	}
	return true
}

func projectRuntimeVariableInputs(variables []db.ProjectRuntimeVariable) []projectRuntimeVariableInput {
	result := make([]projectRuntimeVariableInput, 0, len(variables))
	for _, variable := range variables {
		result = append(result, projectRuntimeVariableInput{Key: variable.Key, Value: variable.Value})
	}
	return result
}

func reservedProjectRuntimeVariable(key string) bool {
	return strings.HasPrefix(key, "DEPLOY_") ||
		key == "BLUE_DEPLOY_PORT" ||
		key == "GREEN_DEPLOY_PORT" ||
		strings.HasSuffix(key, "_IMAGE_TAG")
}

func containsControlCharacter(value string) bool {
	for _, character := range value {
		if unicode.IsControl(character) {
			return true
		}
	}
	return false
}

func renderedRuntimeVariableSize(variable projectRuntimeVariableInput) int {
	size := len(variable.Key) + len(variable.Value) + 4 // KEY="value"\n
	for _, character := range variable.Value {
		switch character {
		case '\\', '"', '$', '`':
			size++
		}
	}
	return size
}
