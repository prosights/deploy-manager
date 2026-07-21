package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"deploy-manager/internal/db"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type applicationServiceRuntimeConfigRequest struct {
	DopplerProject string                        `json:"doppler_project"`
	DopplerConfig  string                        `json:"doppler_config"`
	Variables      []projectRuntimeVariableInput `json:"variables"`
}

type applicationServiceRuntimeConfigResponse struct {
	ComposeService        string                        `json:"compose_service"`
	DopplerProject        string                        `json:"doppler_project"`
	DopplerConfig         string                        `json:"doppler_config"`
	Variables             []projectRuntimeVariableInput `json:"variables"`
	ConfigurationRevision int64                         `json:"configuration_revision"`
	Changed               bool                          `json:"changed"`
}

const applicationStackRuntimeConfig = "__stack__"

func (s Server) listApplicationServiceRuntimeConfigs(w http.ResponseWriter, r *http.Request) {
	applicationID, err := parseUUIDParam(r, "applicationID")
	if err != nil {
		writeError(w, err)
		return
	}
	application, err := s.queries.GetApplication(r.Context(), applicationID)
	if err != nil {
		writeError(w, applicationLookupError(err, "service not found"))
		return
	}
	configs, err := s.queries.ListApplicationServiceRuntimeConfigs(r.Context(), applicationID)
	if err != nil {
		writeError(w, err)
		return
	}
	response := make([]applicationServiceRuntimeConfigResponse, 0, len(configs))
	for _, config := range configs {
		item, err := serviceRuntimeConfigResponse(config, application.ConfigurationRevision, false)
		if err != nil {
			writeError(w, err)
			return
		}
		response = append(response, item)
	}
	writeJSON(w, http.StatusOK, response)
}

func (s Server) replaceApplicationServiceRuntimeConfig(w http.ResponseWriter, r *http.Request) {
	applicationID, err := parseUUIDParam(r, "applicationID")
	if err != nil {
		writeError(w, err)
		return
	}
	composeService := strings.TrimSpace(chi.URLParam(r, "composeService"))
	var request applicationServiceRuntimeConfigRequest
	if err := readJSON(w, r, &request); err != nil {
		writeError(w, err)
		return
	}
	request, err = normalizeApplicationServiceRuntimeConfig(request)
	if err != nil {
		writeError(w, err)
		return
	}

	response, changed, err := s.storeApplicationServiceRuntimeConfig(r.Context(), applicationID, composeService, request)
	if err != nil {
		writeError(w, err)
		return
	}
	response.Changed = changed
	if changed {
		s.audit(r, "application.service_variables_update", "application", uuidString(applicationID), composeService, map[string]any{
			"compose_service":        composeService,
			"doppler_scoped":         request.DopplerProject != "",
			"variable_count":         len(request.Variables),
			"configuration_revision": response.ConfigurationRevision,
		})
	}
	writeJSON(w, http.StatusOK, response)
}

func normalizeApplicationServiceRuntimeConfig(request applicationServiceRuntimeConfigRequest) (applicationServiceRuntimeConfigRequest, error) {
	request.DopplerProject = strings.TrimSpace(request.DopplerProject)
	request.DopplerConfig = strings.TrimSpace(request.DopplerConfig)
	if (request.DopplerProject == "") != (request.DopplerConfig == "") {
		return request, validationError("doppler project and config must be provided together")
	}
	if request.DopplerProject != "" {
		if err := validateDopplerScopeValue("doppler project", request.DopplerProject); err != nil {
			return request, err
		}
		if err := validateDopplerScopeValue("doppler config", request.DopplerConfig); err != nil {
			return request, err
		}
	}
	variables, err := normalizeProjectRuntimeVariables(request.Variables)
	if err != nil {
		return request, err
	}
	request.Variables = variables
	return request, nil
}

func (s Server) storeApplicationServiceRuntimeConfig(ctx context.Context, applicationID pgtype.UUID, composeService string, request applicationServiceRuntimeConfigRequest) (applicationServiceRuntimeConfigResponse, bool, error) {
	if s.tx == nil {
		return applicationServiceRuntimeConfigResponse{}, false, errors.New("database transactions are not configured")
	}
	tx, err := s.tx.Begin(ctx)
	if err != nil {
		return applicationServiceRuntimeConfigResponse{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	queries := s.queries.WithTx(tx)
	application, err := queries.GetApplicationForUpdate(ctx, applicationID)
	if err != nil {
		return applicationServiceRuntimeConfigResponse{}, false, applicationLookupError(err, "service not found")
	}
	if composeService != applicationStackRuntimeConfig && !applicationHasComposeService(application, composeService) {
		return applicationServiceRuntimeConfigResponse{}, false, validationError("compose service was not found in the scanned stack")
	}

	existing, err := queries.GetApplicationServiceRuntimeConfig(ctx, db.GetApplicationServiceRuntimeConfigParams{ApplicationID: applicationID, ComposeService: composeService})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return applicationServiceRuntimeConfigResponse{}, false, err
	}
	if err == nil && serviceRuntimeConfigMatches(existing, request) {
		if err := tx.Commit(ctx); err != nil {
			return applicationServiceRuntimeConfigResponse{}, false, err
		}
		response, err := serviceRuntimeConfigResponse(existing, application.ConfigurationRevision, false)
		return response, false, err
	}

	empty := request.DopplerProject == "" && len(request.Variables) == 0
	if errors.Is(err, pgx.ErrNoRows) && empty {
		if err := tx.Commit(ctx); err != nil {
			return applicationServiceRuntimeConfigResponse{}, false, err
		}
		return applicationServiceRuntimeConfigResponse{ComposeService: composeService, Variables: []projectRuntimeVariableInput{}, ConfigurationRevision: application.ConfigurationRevision}, false, nil
	}

	var stored db.ApplicationServiceRuntimeConfig
	if empty {
		if err := queries.DeleteApplicationServiceRuntimeConfig(ctx, db.DeleteApplicationServiceRuntimeConfigParams{ApplicationID: applicationID, ComposeService: composeService}); err != nil {
			return applicationServiceRuntimeConfigResponse{}, false, err
		}
	} else {
		variables, err := json.Marshal(request.Variables)
		if err != nil {
			return applicationServiceRuntimeConfigResponse{}, false, err
		}
		stored, err = queries.UpsertApplicationServiceRuntimeConfig(ctx, db.UpsertApplicationServiceRuntimeConfigParams{
			ApplicationID:  applicationID,
			ComposeService: composeService,
			DopplerProject: optionalText(request.DopplerProject),
			DopplerConfig:  optionalText(request.DopplerConfig),
			Variables:      variables,
		})
		if err != nil {
			return applicationServiceRuntimeConfigResponse{}, false, err
		}
	}
	if err := queries.BumpApplicationConfigurationRevision(ctx, applicationID); err != nil {
		return applicationServiceRuntimeConfigResponse{}, false, err
	}
	application.ConfigurationRevision++
	if err := tx.Commit(ctx); err != nil {
		return applicationServiceRuntimeConfigResponse{}, false, err
	}
	if empty {
		return applicationServiceRuntimeConfigResponse{ComposeService: composeService, Variables: []projectRuntimeVariableInput{}, ConfigurationRevision: application.ConfigurationRevision}, true, nil
	}
	response, err := serviceRuntimeConfigResponse(stored, application.ConfigurationRevision, true)
	return response, true, err
}

func serviceRuntimeConfigMatches(existing db.ApplicationServiceRuntimeConfig, request applicationServiceRuntimeConfigRequest) bool {
	if existing.DopplerProject.String != request.DopplerProject || existing.DopplerConfig.String != request.DopplerConfig {
		return false
	}
	var variables []projectRuntimeVariableInput
	return json.Unmarshal(existing.Variables, &variables) == nil && runtimeVariableInputsEqual(variables, request.Variables)
}

func runtimeVariableInputsEqual(left, right []projectRuntimeVariableInput) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func serviceRuntimeConfigResponse(config db.ApplicationServiceRuntimeConfig, revision int64, changed bool) (applicationServiceRuntimeConfigResponse, error) {
	variables := []projectRuntimeVariableInput{}
	if err := json.Unmarshal(config.Variables, &variables); err != nil {
		return applicationServiceRuntimeConfigResponse{}, err
	}
	return applicationServiceRuntimeConfigResponse{
		ComposeService:        config.ComposeService,
		DopplerProject:        config.DopplerProject.String,
		DopplerConfig:         config.DopplerConfig.String,
		Variables:             variables,
		ConfigurationRevision: revision,
		Changed:               changed,
	}, nil
}

func applicationHasComposeService(application db.Application, composeService string) bool {
	if composeService == "" {
		return false
	}
	var services []githubComposeService
	if json.Unmarshal(application.ComposeServices, &services) != nil {
		return false
	}
	for _, service := range services {
		if service.Name == composeService {
			return true
		}
	}
	return false
}

func optionalText(value string) pgtype.Text {
	return pgtype.Text{String: value, Valid: value != ""}
}
