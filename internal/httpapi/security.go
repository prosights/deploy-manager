package httpapi

import (
	"net/http"
	"strings"
)

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := w.Header()
		header.Set("X-Content-Type-Options", "nosniff")
		header.Set("Referrer-Policy", "no-referrer")
		header.Set("X-Frame-Options", "DENY")
		header.Set("Content-Security-Policy", "frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

func sameHostOrigin(origin string, host string) bool {
	origin = strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(origin, "http://"), "https://"))
	return strings.EqualFold(origin, host)
}
