package httpapi

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

// requireAuth gates protected endpoints behind a static bearer token.
//
// The token is supplied via the API_TOKEN environment variable. Local
// development can explicitly disable auth through AUTH_DISABLED=true.
func requireAuth(token string) func(http.Handler) http.Handler {
	expected := []byte(token)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !validBearerToken(r.Header.Get("Authorization"), expected) {
				w.Header().Set("WWW-Authenticate", "Bearer")
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func validBearerToken(header string, expected []byte) bool {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return false
	}
	presented := []byte(strings.TrimSpace(strings.TrimPrefix(header, prefix)))
	if len(presented) == 0 {
		return false
	}
	return subtle.ConstantTimeCompare(presented, expected) == 1
}
