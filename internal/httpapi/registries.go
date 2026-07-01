package httpapi

import (
	"net/http"
	"strings"

	"deploy-manager/internal/db"
)

func (s Server) listContainerRegistries(w http.ResponseWriter, r *http.Request) {
	registries, err := s.queries.ListContainerRegistries(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, registries)
}

func (s Server) upsertContainerRegistry(w http.ResponseWriter, r *http.Request) {
	var input db.UpsertContainerRegistryParams
	if err := readJSON(w, r, &input); err != nil {
		writeError(w, err)
		return
	}
	input, err := normalizeContainerRegistry(input)
	if err != nil {
		writeError(w, err)
		return
	}
	registry, err := s.queries.UpsertContainerRegistry(r.Context(), input)
	if err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "container_registry.upsert", "container_registry", uuidString(registry.ID), registry.Name, map[string]any{
		"provider": registry.Provider,
		"host":     registry.RegistryHost,
		"enabled":  registry.Enabled,
	})
	writeJSON(w, http.StatusOK, registry)
}

func normalizeContainerRegistry(input db.UpsertContainerRegistryParams) (db.UpsertContainerRegistryParams, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Provider = strings.TrimSpace(input.Provider)
	input.RegistryHost = strings.TrimSpace(input.RegistryHost)
	input.Namespace = strings.Trim(strings.TrimSpace(input.Namespace), "/")
	input.Repository = strings.Trim(strings.TrimSpace(input.Repository), "/")
	input.DefaultImage = strings.Trim(strings.TrimSpace(input.DefaultImage), "/")

	if input.Name == "" || input.RegistryHost == "" || input.Repository == "" {
		return input, validationError("name, registry_host, and repository are required")
	}
	if !validContainerRegistryProvider(input.Provider) {
		return input, validationError("provider must be gcp_artifact_registry, docker_hub, ghcr, ecr, or custom")
	}
	for field, value := range map[string]string{
		"name":          input.Name,
		"registry_host": input.RegistryHost,
		"namespace":     input.Namespace,
		"repository":    input.Repository,
		"default_image": input.DefaultImage,
	} {
		if strings.ContainsAny(value, "\r\n\t") {
			return input, validationError(field + " cannot contain control characters")
		}
	}
	if strings.ContainsAny(input.RegistryHost, "/: ") {
		return input, validationError("registry_host must be a hostname without scheme or path")
	}
	if invalidImagePathPart(input.Namespace) || invalidImagePathPart(input.Repository) || invalidImagePathPart(input.DefaultImage) {
		return input, validationError("namespace, repository, and default_image cannot contain whitespace or empty path segments")
	}
	return input, nil
}

func validContainerRegistryProvider(provider string) bool {
	switch provider {
	case "gcp_artifact_registry", "docker_hub", "ghcr", "ecr", "custom":
		return true
	default:
		return false
	}
}

func invalidImagePathPart(value string) bool {
	return strings.ContainsAny(value, " \n\r\t") || strings.Contains(value, "//")
}
