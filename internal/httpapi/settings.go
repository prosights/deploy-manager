package httpapi

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"deploy-manager/internal/db"
)

var hexColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func (s Server) settings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.queries.GetInstanceSettings(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s Server) updateSettings(w http.ResponseWriter, r *http.Request) {
	var input db.UpdateInstanceSettingsParams
	if err := readJSON(w, r, &input); err != nil {
		writeError(w, err)
		return
	}
	input, err := normalizeInstanceSettings(input)
	if err != nil {
		writeError(w, err)
		return
	}

	settings, err := s.queries.UpdateInstanceSettings(r.Context(), input)
	if err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "settings.update", "settings", uuidString(settings.ID), settings.Name, map[string]any{"short_name": settings.ShortName, "primary_color": settings.PrimaryColor})
	writeJSON(w, http.StatusOK, settings)
}

func normalizeInstanceSettings(input db.UpdateInstanceSettingsParams) (db.UpdateInstanceSettingsParams, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.ShortName = strings.TrimSpace(input.ShortName)
	input.MetaDescription = strings.TrimSpace(input.MetaDescription)
	input.LogoUrl = strings.TrimSpace(input.LogoUrl)
	input.FaviconUrl = strings.TrimSpace(input.FaviconUrl)
	input.PrimaryColor = strings.TrimSpace(input.PrimaryColor)
	input.DocsUrl = strings.TrimSpace(input.DocsUrl)
	if input.Name == "" || input.ShortName == "" {
		return input, validationError("name and short_name are required")
	}
	if strings.ContainsAny(input.Name+input.ShortName+input.MetaDescription, "\r\n\t") {
		return input, validationError("branding text fields cannot contain control characters")
	}
	if input.PrimaryColor == "" {
		input.PrimaryColor = "#0980fd"
	}
	if !hexColorPattern.MatchString(input.PrimaryColor) {
		return input, validationError("primary_color must be a 6-digit hex color")
	}
	if input.DocsUrl == "" {
		input.DocsUrl = "#"
	}
	if err := validateBrandURL("logo_url", input.LogoUrl); err != nil {
		return input, err
	}
	if err := validateBrandURL("favicon_url", input.FaviconUrl); err != nil {
		return input, err
	}
	if err := validateBrandURL("docs_url", input.DocsUrl); err != nil {
		return input, err
	}
	if err := validateBrandAssetURL("logo_url", input.LogoUrl, []string{".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif"}); err != nil {
		return input, err
	}
	if err := validateBrandAssetURL("favicon_url", input.FaviconUrl, []string{".ico", ".png", ".svg"}); err != nil {
		return input, err
	}
	return input, nil
}

func validateBrandURL(field string, value string) error {
	if value == "" || value == "#" {
		return nil
	}
	if strings.HasPrefix(value, "data:image/") {
		return nil
	}
	if strings.ContainsAny(value, "\r\n\t") {
		return validationError(fmt.Sprintf("%s cannot contain control characters", field))
	}
	if strings.HasPrefix(value, "//") {
		return validationError(fmt.Sprintf("%s must be a relative path or absolute http(s) URL", field))
	}
	if strings.HasPrefix(value, "/") {
		return nil
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" {
		return validationError(fmt.Sprintf("%s must be a relative path or absolute http(s) URL", field))
	}
	switch parsed.Scheme {
	case "http", "https":
		return nil
	default:
		return validationError(fmt.Sprintf("%s must use http or https", field))
	}
}

func validateBrandAssetURL(field string, value string, allowedExtensions []string) error {
	if value == "" || strings.HasPrefix(value, "data:image/") {
		return nil
	}
	path := value
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
		parsed, err := url.Parse(value)
		if err != nil {
			return validationError(fmt.Sprintf("%s must be a relative path or absolute http(s) URL", field))
		}
		path = parsed.Path
	}
	path = strings.ToLower(strings.SplitN(path, "?", 2)[0])
	path = strings.SplitN(path, "#", 2)[0]
	for _, extension := range allowedExtensions {
		if strings.HasSuffix(path, extension) {
			return nil
		}
	}
	return validationError(fmt.Sprintf("%s must point to a supported image asset", field))
}
