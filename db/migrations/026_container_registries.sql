CREATE TABLE IF NOT EXISTS container_registries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    provider text NOT NULL CHECK (provider IN ('gcp_artifact_registry', 'docker_hub', 'ghcr', 'ecr', 'custom')),
    registry_host text NOT NULL,
    namespace text NOT NULL DEFAULT '',
    repository text NOT NULL,
    default_image text NOT NULL DEFAULT '',
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(name) <> ''),
    CHECK (btrim(registry_host) <> ''),
    CHECK (btrim(repository) <> ''),
    CHECK (name !~ '[[:cntrl:]]' AND registry_host !~ '[[:cntrl:]]' AND namespace !~ '[[:cntrl:]]' AND repository !~ '[[:cntrl:]]' AND default_image !~ '[[:cntrl:]]'),
    CHECK (registry_host !~ '[/:[:space:]]'),
    CHECK (namespace = '' OR namespace !~ '(^/|/$|//|[[:space:]])'),
    CHECK (repository !~ '(^/|/$|//|[[:space:]])'),
    CHECK (default_image = '' OR default_image !~ '(^/|/$|//|[[:space:]])')
);

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS default_registry_id uuid REFERENCES container_registries(id) ON DELETE SET NULL;
