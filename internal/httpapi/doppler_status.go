package httpapi

import "net/http"

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
		writeJSON(w, http.StatusOK, dopplerStatusResponse{
			ConnectorConfigured: true,
			Missing:             []string{"Doppler CLI"},
			Message:             err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, dopplerStatusResponse{
		ConnectorConfigured: true,
		CLIAvailable:        true,
		Ready:               true,
		Message:             "Doppler CLI is available on the Deploy Manager server.",
	})
}
