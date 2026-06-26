package httpapi

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (s Server) spa(w http.ResponseWriter, r *http.Request) {
	staticRoot := filepath.Clean(s.static)
	requestPath := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
	if requestPath == "." || requestPath == "/" {
		requestPath = "index.html"
	}

	target := filepath.Join(staticRoot, requestPath)
	if !isSafeStaticPath(staticRoot, target) {
		http.NotFound(w, r)
		return
	}
	if isFile(target) {
		setStaticCacheHeaders(w, requestPath)
		http.ServeFile(w, r, target)
		return
	}
	if shouldNotFallbackToSPA(requestPath) {
		http.NotFound(w, r)
		return
	}

	index := filepath.Join(staticRoot, "index.html")
	if isFile(index) {
		setStaticCacheHeaders(w, "index.html")
		http.ServeFile(w, r, index)
		return
	}
	http.NotFound(w, r)
}

func shouldNotFallbackToSPA(requestPath string) bool {
	requestPath = filepath.ToSlash(strings.TrimSpace(requestPath))
	if strings.HasPrefix(requestPath, "assets/") {
		return true
	}
	return filepath.Ext(requestPath) != ""
}

func setStaticCacheHeaders(w http.ResponseWriter, requestPath string) {
	if filepath.Base(requestPath) == "index.html" {
		w.Header().Set("Cache-Control", "no-cache")
		return
	}
	if strings.HasPrefix(filepath.ToSlash(requestPath), "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
}

func isSafeStaticPath(root string, target string) bool {
	relative, err := filepath.Rel(root, target)
	if err != nil {
		return false
	}
	return relative == "." || (!strings.HasPrefix(relative, ".."+string(filepath.Separator)) && relative != "..")
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}
