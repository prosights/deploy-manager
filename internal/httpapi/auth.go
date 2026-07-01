package httpapi

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

// requireAuth gates protected endpoints behind a static bearer token.
//
// The token is supplied via the API_TOKEN environment variable. When no token
// is configured the middleware is not installed at all (see New), so this
// handler always assumes a non-empty expected token.
func requireAuth(token string) func(http.Handler) http.Handler {
	expected := []byte(token)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !validBearerToken(r.Header.Get("Authorization"), expected) &&
				!validQueryToken(r.URL.Query().Get("access_token"), expected) {
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

// validQueryToken supports authenticating SSE (EventSource) requests, which
// cannot set custom headers, via an access_token query parameter.
func validQueryToken(value string, expected []byte) bool {
	presented := []byte(strings.TrimSpace(value))
	if len(presented) == 0 {
		return false
	}
	return subtle.ConstantTimeCompare(presented, expected) == 1
}
