package httpapi

import (
	"net/http"
	"os"
	"strings"
)

type versionResponse struct {
	Version   string `json:"version"`
	CommitSHA string `json:"commit_sha"`
	BuildTime string `json:"build_time"`
}

func (s Server) version(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, versionResponse{
		Version:   versionEnv("APP_VERSION", "dev"),
		CommitSHA: versionEnv("APP_COMMIT_SHA", ""),
		BuildTime: versionEnv("APP_BUILD_TIME", ""),
	})
}

func versionEnv(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}
