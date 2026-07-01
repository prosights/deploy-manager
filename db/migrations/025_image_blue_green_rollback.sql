ALTER TABLE deployments
    ADD COLUMN IF NOT EXISTS image_ref text,
    ADD COLUMN IF NOT EXISTS image_digest text;

ALTER TABLE deployments
    DROP CONSTRAINT IF EXISTS deployments_trigger_check;

ALTER TABLE deployments
    ADD CONSTRAINT deployments_trigger_check
    CHECK (trigger IN ('manual', 'github_push', 'connector_sync', 'retry', 'rollback'));

ALTER TABLE deployments
    ADD CONSTRAINT deployments_image_ref_safe
    CHECK (image_ref IS NULL OR (btrim(image_ref) <> '' AND length(image_ref) <= 512 AND image_ref !~ '[[:space:][:cntrl:]]')) NOT VALID;

ALTER TABLE deployments
    ADD CONSTRAINT deployments_image_digest_sha256
    CHECK (image_digest IS NULL OR image_digest ~ '^sha256:[0-9a-f]{64}$') NOT VALID;

ALTER TABLE proxy_routes
    ADD COLUMN IF NOT EXISTS blue_upstream_url text,
    ADD COLUMN IF NOT EXISTS green_upstream_url text;

ALTER TABLE proxy_routes
    ADD CONSTRAINT proxy_routes_blue_upstream_origin_url
    CHECK (blue_upstream_url IS NULL OR (btrim(blue_upstream_url) <> '' AND blue_upstream_url ~ '^https?://[^/?#]+/?$' AND blue_upstream_url !~ '[[:cntrl:]]' AND blue_upstream_url !~ '^https?://[^/@]+@')) NOT VALID;

ALTER TABLE proxy_routes
    ADD CONSTRAINT proxy_routes_green_upstream_origin_url
    CHECK (green_upstream_url IS NULL OR (btrim(green_upstream_url) <> '' AND green_upstream_url ~ '^https?://[^/?#]+/?$' AND green_upstream_url !~ '[[:cntrl:]]' AND green_upstream_url !~ '^https?://[^/@]+@')) NOT VALID;

CREATE TABLE IF NOT EXISTS application_deployment_slots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    color text NOT NULL CHECK (color IN ('blue', 'green')),
    deployment_id uuid REFERENCES deployments(id) ON DELETE SET NULL,
    image_ref text NOT NULL,
    image_digest text,
    status text NOT NULL CHECK (status IN ('active', 'standby', 'failed')),
    promoted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(image_ref) <> '' AND length(image_ref) <= 512 AND image_ref !~ '[[:space:][:cntrl:]]'),
    CHECK (image_digest IS NULL OR image_digest ~ '^sha256:[0-9a-f]{64}$'),
    UNIQUE(application_id, server_id, color)
);

CREATE INDEX IF NOT EXISTS application_deployment_slots_lookup_idx
    ON application_deployment_slots(application_id, server_id, status, updated_at DESC);
