package objectstorage

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"deploy-manager/internal/connectors"
)

type Connector struct {
	provider string
}

type connectorConfig struct {
	Buckets []BucketInventory `json:"buckets"`
}

func NewConnector(provider string) Connector {
	return Connector{provider: normalizeProvider(provider)}
}

func (c Connector) Provider() string {
	return c.provider
}

func (c Connector) SyncCredentials(_ context.Context, scope connectors.SyncScope) ([]connectors.CredentialInventory, error) {
	if c.provider != "s3" && c.provider != "gcs" {
		return nil, fmt.Errorf("provider must be s3 or gcs")
	}

	var config connectorConfig
	if err := json.Unmarshal(scope.Config, &config); err != nil {
		return nil, fmt.Errorf("parse object storage connector config: %w", err)
	}
	if len(config.Buckets) == 0 {
		return nil, fmt.Errorf("object storage connector config requires buckets")
	}

	inventory := make([]connectors.CredentialInventory, 0, len(config.Buckets))
	for _, bucket := range config.Buckets {
		if strings.TrimSpace(bucket.Provider) == "" {
			bucket.Provider = c.provider
		}
		if normalizeProvider(bucket.Provider) != c.provider {
			return nil, fmt.Errorf("bucket provider must match %s connector", c.provider)
		}
		item, err := ToCredentialInventory(bucket)
		if err != nil {
			return nil, err
		}
		inventory = append(inventory, item)
	}
	return inventory, nil
}
