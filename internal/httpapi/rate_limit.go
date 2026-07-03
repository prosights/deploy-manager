package httpapi

import (
	"net"
	"net/http"
	"sync"
	"time"
)

type rateWindow struct {
	start time.Time
	count int
}

func rateLimit(maxRequests int, window time.Duration) func(http.Handler) http.Handler {
	var mu sync.Mutex
	clients := map[string]rateWindow{}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := clientKey(r)
			now := time.Now()

			mu.Lock()
			current := clients[key]
			if now.Sub(current.start) >= window {
				current = rateWindow{start: now}
			}
			current.count++
			clients[key] = current
			allowed := current.count <= maxRequests
			mu.Unlock()

			if !allowed {
				writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate limit exceeded"})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func clientKey(r *http.Request) string {
	if ip := net.ParseIP(r.RemoteAddr); ip != nil {
		return ip.String()
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}
