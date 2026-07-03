package httpapi

import (
	"net/http"

	"deploy-manager/internal/githubconnector"
)

type githubRepositoryResponse struct {
	ConnectorID   string `json:"connector_id"`
	ConnectorName string `json:"connector_name"`
	Repository    string `json:"repository"`
	Branch        string `json:"branch"`
	CloneURL      string `json:"clone_url"`
	WebURL        string `json:"web_url"`
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
				ConnectorID:   uuidString(account.ID),
				ConnectorName: account.Name,
				Repository:    item.Repository,
				Branch:        item.Branch,
				CloneURL:      "https://github.com/" + item.Repository + ".git",
				WebURL:        "https://github.com/" + item.Repository,
			})
		}
	}

	writeJSON(w, http.StatusOK, repositories)
}
