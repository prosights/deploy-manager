package httpapi

import (
	"net/http"

	"deploy-manager/internal/objectstorage"
)

type credentialInventoryInput struct {
	Credentials []credentialInventoryItem `json:"credentials"`
}

type credentialInventoryItem struct {
	Name           string                      `json:"name"`
	Provider       string                      `json:"provider"`
	ExternalRef    string                      `json:"external_ref"`
	CredentialType string                      `json:"credential_type"`
	Status         string                      `json:"status"`
	Permissions    []credentialPermissionInput `json:"permissions"`
	Usages         []credentialUsageInput      `json:"usages"`
}

type credentialPermissionInput struct {
	ResourceType string `json:"resource_type"`
	ResourceName string `json:"resource_name"`
	Permission   string `json:"permission"`
	Source       string `json:"source"`
}

type credentialUsageInput struct {
	UsedByType   string `json:"used_by_type"`
	UsedByName   string `json:"used_by_name"`
	UsageContext string `json:"usage_context"`
}

type objectStorageInventoryInput struct {
	Buckets []objectstorage.BucketInventory `json:"buckets"`
}

func (s Server) upsertCredentialInventory(w http.ResponseWriter, r *http.Request) {
	var input credentialInventoryInput
	if err := readJSON(w, r, &input); err != nil {
		writeError(w, err)
		return
	}
	input, err := normalizeCredentialInventoryInput(input)
	if err != nil {
		writeError(w, err)
		return
	}

	upserted, providers, err := s.upsertCredentialInventoryBatch(r.Context(), input.Credentials)
	if err != nil {
		writeError(w, err)
		return
	}
	s.markInventoryConnectorsSynced(r, inventoryProviderCounts(providers), "credential inventory")

	writeJSON(w, http.StatusAccepted, map[string]any{
		"credentials": upserted,
		"count":       len(upserted),
	})
	s.audit(r, "credentials.inventory_sync", "credential", "batch", "credential inventory", map[string]any{"count": len(upserted)})
}

func (s Server) upsertObjectStorageInventory(w http.ResponseWriter, r *http.Request) {
	var input objectStorageInventoryInput
	if err := readJSON(w, r, &input); err != nil {
		writeError(w, err)
		return
	}
	if len(input.Buckets) == 0 {
		writeError(w, validationError("buckets are required"))
		return
	}

	credentials, err := credentialInventoryFromObjectStorage(input.Buckets)
	if err != nil {
		writeError(w, err)
		return
	}

	upserted, providers, err := s.upsertCredentialInventoryBatch(r.Context(), credentials)
	if err != nil {
		writeError(w, err)
		return
	}
	s.markInventoryConnectorsSynced(r, inventoryProviderCounts(providers), "object storage inventory")

	writeJSON(w, http.StatusAccepted, map[string]any{
		"credentials": upserted,
		"count":       len(upserted),
	})
	s.audit(r, "object_storage.inventory_sync", "credential", "batch", "object storage inventory", map[string]any{"count": len(upserted)})
}
