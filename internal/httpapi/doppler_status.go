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

// DopplerSource is the Doppler CLI wrapper; runtime secrets only come from here.
type DopplerSource interface {
	Check() error
	ListProjects(context.Context) ([]string, error)
	ListConfigs(context.Context, string) ([]string, error)
}

func (s Server) dopplerStatus(w http.ResponseWriter, r *http.Request) {
	if s.doppler == nil {
		writeJSON(w, http.StatusOK, dopplerStatusResponse{
			Missing: []string{"Doppler runtime connector"},
			Message: "Doppler runtime connector is not registered.",
		})
		return
	}

	if err := s.doppler.Check(); err != nil {
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
		Message:             "Doppler CLI is available on the Paddock server.",
	})
}

func (s Server) dopplerProjects(w http.ResponseWriter, r *http.Request) {
	if s.doppler == nil {
		writeError(w, notFoundError("Doppler connector is not configured"))
		return
	}
	projects, err := s.doppler.ListProjects(r.Context())
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
	if s.doppler == nil {
		writeError(w, notFoundError("Doppler connector is not configured"))
		return
	}
	configs, err := s.doppler.ListConfigs(r.Context(), project)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, configs)
}
