package httpapi

import (
	"net/http"
	"strings"
)

type githubStatusResponse struct {
	WebhookConfigured     bool     `json:"webhook_configured"`
	AppConfigured         bool     `json:"app_configured"`
	RepositorySyncEnabled bool     `json:"repository_sync_enabled"`
	BuildDispatchEnabled  bool     `json:"build_dispatch_enabled"`
	InstallURL            string   `json:"install_url"`
	Missing               []string `json:"missing"`
}

func (s Server) githubStatus(w http.ResponseWriter, _ *http.Request) {
	appConfigured := s.github.App != nil
	webhookConfigured := s.github.Secret != ""
	installURL := githubInstallURL(s.github.AppSlug)
	missing := make([]string, 0, 2)
	if installURL == "" {
		missing = append(missing, "GITHUB_APP_SLUG")
	}
	if !appConfigured {
		missing = append(missing, "GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH")
	}
	writeJSON(w, http.StatusOK, githubStatusResponse{
		WebhookConfigured:     webhookConfigured,
		AppConfigured:         appConfigured,
		RepositorySyncEnabled: appConfigured,
		BuildDispatchEnabled:  appConfigured,
		InstallURL:            installURL,
		Missing:               missing,
	})
}

func githubInstallURL(slug string) string {
	slug = strings.Trim(strings.TrimSpace(slug), "/")
	if slug == "" || strings.ContainsAny(slug, "\r\n\t ") {
		return ""
	}
	return "https://github.com/apps/" + slug + "/installations/new"
}
