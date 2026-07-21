package httpapi

import (
	"context"
	"net/http"
	"strings"
)

type dopplerStatusResponse struct {
	ConnectorConfigured bool     `json:"connector_configured"`
	CLIAvailable        bool     `json:"cli_available"`
	Ready               bool     `json:"ready"`
	Missing             []string `json:"missing"`
	Message             string   `json:"message"`
}

type dopplerChecker interface {
	Check() error
}

type dopplerCatalog interface {
	ListProjects(context.Context) ([]string, error)
	ListConfigs(context.Context, string) ([]string, error)
}

func (s Server) dopplerStatus(w http.ResponseWriter, r *http.Request) {
	source, ok := s.sources["doppler"]
	if !ok {
		writeJSON(w, http.StatusOK, dopplerStatusResponse{
			Missing: []string{"Doppler runtime connector"},
			Message: "Doppler runtime connector is not registered.",
		})
		return
	}

	checker, ok := source.(dopplerChecker)
	if !ok {
		writeJSON(w, http.StatusOK, dopplerStatusResponse{
			ConnectorConfigured: true,
			Missing:             []string{"Doppler CLI check"},
			Message:             "Doppler runtime connector does not expose a CLI check.",
		})
		return
	}

	if err := checker.Check(); err != nil {
		missing := []string{"Doppler CLI"}
		cliAvailable := false
		if strings.Contains(err.Error(), "DOPPLER_TOKEN") {
			missing = []string{"DOPPLER_TOKEN"}
			cliAvailable = true
		}
		writeJSON(w, http.StatusOK, dopplerStatusResponse{
			ConnectorConfigured: true,
			CLIAvailable:        cliAvailable,
			Missing:             missing,
			Message:             err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, dopplerStatusResponse{
		ConnectorConfigured: true,
		CLIAvailable:        true,
		Ready:               true,
		Missing:             []string{},
		Message:             "Doppler CLI is available on the Deploy Manager server.",
	})
}

func (s Server) dopplerProjects(w http.ResponseWriter, r *http.Request) {
	catalog, ok := s.sources["doppler"].(dopplerCatalog)
	if !ok {
		writeError(w, notFoundError("Doppler connector is not configured"))
		return
	}
	projects, err := catalog.ListProjects(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

func (s Server) dopplerConfigs(w http.ResponseWriter, r *http.Request) {
	project := strings.TrimSpace(r.URL.Query().Get("project"))
	if project == "" {
		writeError(w, validationError("Doppler project is required"))
		return
	}
	if err := validateDopplerScopeValue("Doppler project", project); err != nil {
		writeError(w, err)
		return
	}
	catalog, ok := s.sources["doppler"].(dopplerCatalog)
	if !ok {
		writeError(w, notFoundError("Doppler connector is not configured"))
		return
	}
	configs, err := catalog.ListConfigs(r.Context(), project)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, configs)
}
