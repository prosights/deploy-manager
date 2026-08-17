package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"
)

const sessionCookieName = "dm_session"

// requireAuth gates protected endpoints behind a static bearer token, supplied
// either as an Authorization header or as the HttpOnly session cookie set by
// the login endpoint.
//
// The token is supplied via the API_TOKEN environment variable. Local
// development can explicitly disable auth through AUTH_DISABLED=true.
func requireAuth(token string) func(http.Handler) http.Handler {
	expected := []byte(token)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !validBearerToken(r.Header.Get("Authorization"), expected) && !validSessionRequest(r, expected) {
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

// ponytail: the cookie stores the API token itself (HttpOnly, so scripts can't
// read it). Move to signed random session IDs if per-session revocation is needed.
func validSessionCookie(r *http.Request, expected []byte) bool {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(cookie.Value), expected) == 1
}

func validSessionRequest(r *http.Request, expected []byte) bool {
	if !validSessionCookie(r, expected) {
		return false
	}
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	default:
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		return strings.HasPrefix(strings.ToLower(origin), "https://") && sameHostOrigin(origin, r.Host)
	}
}

func sessionCookie(r *http.Request, auth AuthConfig, value string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     sessionCookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   !auth.Disabled || r.TLS != nil,
		SameSite: http.SameSiteLaxMode,
	}
}

// login exchanges the API token for the HttpOnly session cookie.
func login(auth AuthConfig) http.HandlerFunc {
	expected := []byte(auth.Token)
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Token string `json:"token"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		if !auth.Disabled && subtle.ConstantTimeCompare([]byte(body.Token), expected) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid token"})
			return
		}
		http.SetCookie(w, sessionCookie(r, auth, auth.Token, 30*24*60*60))
		w.WriteHeader(http.StatusNoContent)
	}
}

func logout(auth AuthConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, sessionCookie(r, auth, "", -1))
		w.WriteHeader(http.StatusNoContent)
	}
}

// session reports whether the request is authenticated so the SPA can decide
// between the login page and the app shell without triggering a 401.
func session(auth AuthConfig) http.HandlerFunc {
	expected := []byte(auth.Token)
	return func(w http.ResponseWriter, r *http.Request) {
		authenticated := auth.Disabled ||
			validBearerToken(r.Header.Get("Authorization"), expected) ||
			validSessionCookie(r, expected)
		writeJSON(w, http.StatusOK, map[string]bool{"authenticated": authenticated})
	}
}
