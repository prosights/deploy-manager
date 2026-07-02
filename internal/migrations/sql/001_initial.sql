CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS instance_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL DEFAULT 'Deploy Manager',
    short_name text NOT NULL DEFAULT 'Deploy',
    meta_description text NOT NULL DEFAULT 'Internal deployment control plane',
    logo_url text NOT NULL DEFAULT '/branding/prosights/prosights-co-logo.png',
    favicon_url text NOT NULL DEFAULT '/branding/prosights/favicon.png',
    primary_color text NOT NULL DEFAULT '#0980fd',
    docs_url text NOT NULL DEFAULT '#',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(name) <> ''),
    CHECK (btrim(short_name) <> ''),
    CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
    CHECK (logo_url = '' OR logo_url ~ '^data:image/' OR logo_url ~* '[.](svg|png|jpg|jpeg|webp|gif)([?#].*)?$'),
    CHECK (favicon_url = '' OR favicon_url ~ '^data:image/' OR favicon_url ~* '[.](ico|png|svg)([?#].*)?$'),
    CHECK (name !~ '[[:cntrl:]]' AND short_name !~ '[[:cntrl:]]' AND meta_description !~ '[[:cntrl:]]' AND logo_url !~ '[[:cntrl:]]' AND favicon_url !~ '[[:cntrl:]]' AND primary_color !~ '[[:cntrl:]]' AND docs_url !~ '[[:cntrl:]]')
);

CREATE TABLE IF NOT EXISTS servers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    hostname text NOT NULL,
    ssh_user text NOT NULL DEFAULT 'root',
    ssh_port integer NOT NULL DEFAULT 22,
    ssh_key_path text,
    connection_mode text NOT NULL DEFAULT 'direct_ssh' CHECK (connection_mode IN ('direct_ssh', 'tailscale_ssh', 'cloud_tunnel')),
    proxy_type text NOT NULL DEFAULT 'caddy' CHECK (proxy_type IN ('caddy', 'traefik', 'none')),
    status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('healthy', 'degraded', 'unreachable', 'unknown')),
    cpu_usage numeric(5,2),
    memory_usage numeric(5,2),
    disk_usage numeric(5,2),
    last_checked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(name) <> ''),
    CHECK (btrim(hostname) <> ''),
    CHECK (btrim(ssh_user) <> ''),
    CHECK (ssh_key_path IS NOT NULL AND btrim(ssh_key_path) <> ''),
    CHECK (left(btrim(ssh_key_path), 1) = '/' OR left(btrim(ssh_key_path), 2) = '~/'),
    CHECK (btrim(ssh_key_path) !~ '//'),
    CHECK (btrim(ssh_key_path) !~ '(^|/)\.\.(/|$)'),
    CHECK (name !~ '[[:cntrl:]]' AND hostname !~ '[[:cntrl:]]' AND ssh_user !~ '[[:cntrl:]]' AND ssh_key_path !~ '[[:cntrl:]]' AND connection_mode !~ '[[:cntrl:]]'),
    CHECK (ssh_port BETWEEN 1 AND 65535),
    CHECK (cpu_usage IS NULL OR (cpu_usage >= 0 AND cpu_usage <= 100)),
    CHECK (memory_usage IS NULL OR (memory_usage >= 0 AND memory_usage <= 100)),
    CHECK (disk_usage IS NULL OR (disk_usage >= 0 AND disk_usage <= 100))
);

CREATE TABLE IF NOT EXISTS projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(name) <> ''),
    CHECK (btrim(slug) <> ''),
    CHECK (slug = lower(slug)),
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' OR slug ~ '^[a-z0-9]$'),
    CHECK (name !~ '[[:cntrl:]]' AND slug !~ '[[:cntrl:]]' AND description !~ '[[:cntrl:]]')
);

INSERT INTO projects (name, slug, description)
VALUES ('Production', 'production', 'Default deployment project')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS environments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name text NOT NULL,
    slug text NOT NULL,
    kind text NOT NULL DEFAULT 'development' CHECK (kind IN ('production', 'development', 'preview')),
    is_ephemeral boolean NOT NULL DEFAULT false,
    pull_request_number integer,
    branch text,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(name) <> ''),
    CHECK (btrim(slug) <> ''),
    CHECK (slug = lower(slug)),
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' OR slug ~ '^[a-z0-9]$'),
    CHECK (name !~ '[[:cntrl:]]' AND slug !~ '[[:cntrl:]]' AND COALESCE(branch, '') !~ '[[:cntrl:]]'),
    CHECK ((kind = 'preview' AND is_ephemeral = true) OR (kind <> 'preview' AND is_ephemeral = false)),
    CHECK (pull_request_number IS NULL OR pull_request_number > 0),
    UNIQUE(project_id, slug)
);

WITH production_project AS (
    SELECT id FROM projects WHERE slug = 'production'
)
INSERT INTO environments (project_id, name, slug, kind, is_ephemeral)
SELECT id, 'Production', 'production', 'production', false FROM production_project
UNION ALL
SELECT id, 'Development', 'development', 'development', false FROM production_project
ON CONFLICT (project_id, slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE RESTRICT,
    server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name text NOT NULL,
    repository_url text,
    branch text NOT NULL DEFAULT 'main',
    compose_path text NOT NULL DEFAULT 'docker-compose.yml',
    remote_directory text NOT NULL,
    domain text,
    health_check_url text,
    doppler_project text,
    doppler_config text,
    status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'deploying', 'healthy', 'failed')),
    current_version text,
    target_version text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(name) <> ''),
    CHECK (repository_url IS NULL OR repository_url ~ '^(git@github[.]com:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+[.]git|https://github[.]com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+([.]git)?)$'),
    CHECK (btrim(branch) <> ''),
    CHECK (btrim(branch) !~ '^-'),
    CHECK (btrim(branch) !~ '(^/|/$|//)'),
    CHECK (btrim(branch) !~ '(\.\.|\.lock$|\.$)'),
    CHECK (btrim(branch) ~ '^[A-Za-z0-9._/-]+$'),
    CHECK (btrim(compose_path) <> ''),
    CHECK (btrim(compose_path) <> '.'),
    CHECK (left(btrim(compose_path), 1) <> '/'),
    CHECK (btrim(compose_path) !~ '(^|/)\.\.(/|$)'),
    CHECK (btrim(remote_directory) <> '' AND left(btrim(remote_directory), 1) = '/' AND btrim(remote_directory) <> '/'),
    CHECK (btrim(remote_directory) !~ '//'),
    CHECK (btrim(remote_directory) !~ '(^|/)\.\.(/|$)'),
    CHECK (health_check_url IS NULL OR (btrim(health_check_url) <> '' AND health_check_url ~ '^https?://' AND health_check_url !~ '[[:cntrl:]]' AND health_check_url !~ '^https?://[^/@]+@')),
    CHECK (doppler_project IS NULL OR (btrim(doppler_project) <> '' AND doppler_project !~ '[[:cntrl:]]')),
    CHECK (doppler_config IS NULL OR (btrim(doppler_config) <> '' AND doppler_config !~ '[[:cntrl:]]')),
    CHECK ((doppler_project IS NULL AND doppler_config IS NULL) OR (doppler_project IS NOT NULL AND doppler_config IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS deployments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    trigger text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'github_push', 'connector_sync', 'retry')),
    strategy text NOT NULL DEFAULT 'rolling' CHECK (strategy IN ('rolling', 'blue_green')),
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    commit_sha text,
    actor text,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (commit_sha IS NULL OR commit_sha ~ '^[0-9A-Fa-f]{7,40}$'),
    CHECK (actor IS NULL OR actor !~ '[[:cntrl:]]'),
    CHECK ((status = 'queued' AND started_at IS NULL AND finished_at IS NULL) OR status <> 'queued'),
    CHECK ((status = 'running' AND started_at IS NOT NULL AND finished_at IS NULL) OR status <> 'running'),
    CHECK ((status IN ('succeeded', 'failed', 'cancelled') AND finished_at IS NOT NULL) OR status NOT IN ('succeeded', 'failed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS proxy_routes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
    domain text NOT NULL,
    upstream_url text NOT NULL,
    tls_enabled boolean NOT NULL DEFAULT true,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'failed')),
    last_applied_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(domain) <> ''),
    CHECK (domain = lower(domain)),
    CHECK (length(domain) <= 253),
    CHECK (domain ~ '^[a-z0-9.-]+$'),
    CHECK (domain !~ '(^|[.])-|-(\.|$)|[.]{2}'),
    CHECK (btrim(upstream_url) <> ''),
    CHECK (upstream_url ~ '^https?://'),
    CHECK (upstream_url !~ '[[:cntrl:]]'),
    CHECK (upstream_url !~ '^https?://[^/@]+@'),
    CHECK (upstream_url ~ '^https?://[^/?#]+/?$'),
    UNIQUE(server_id, domain)
);

CREATE TABLE IF NOT EXISTS deployment_logs (
    id bigserial PRIMARY KEY,
    deployment_id uuid NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    stream text NOT NULL DEFAULT 'stdout' CHECK (stream IN ('stdout', 'stderr', 'system')),
    message text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(message) <> ''),
    CHECK (length(message) <= 32768)
);

CREATE TABLE IF NOT EXISTS credentials (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    provider text NOT NULL,
    external_ref text NOT NULL,
    credential_type text NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotating', 'revoked', 'unknown')),
    last_seen_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(name) <> ''),
    CHECK (provider IN ('github', 'doppler', 's3', 'gcs', 'slack', 'resend', 'ssh')),
    CHECK (btrim(external_ref) <> ''),
    CHECK (btrim(credential_type) <> ''),
    CHECK (name !~ '[[:cntrl:]]' AND external_ref !~ '[[:cntrl:]]' AND credential_type !~ '[[:cntrl:]]'),
    UNIQUE(provider, external_ref)
);

CREATE TABLE IF NOT EXISTS credential_permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    credential_id uuid NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
    resource_type text NOT NULL,
    resource_name text NOT NULL,
    permission text NOT NULL,
    source text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(resource_type) <> ''),
    CHECK (btrim(resource_name) <> ''),
    CHECK (btrim(permission) <> ''),
    CHECK (btrim(source) <> ''),
    CHECK (resource_type !~ '[[:cntrl:]]' AND resource_name !~ '[[:cntrl:]]' AND permission !~ '[[:cntrl:]]' AND source !~ '[[:cntrl:]]'),
    UNIQUE(credential_id, resource_type, resource_name, permission)
);

CREATE TABLE IF NOT EXISTS credential_usages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    credential_id uuid NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
    used_by_type text NOT NULL,
    used_by_name text NOT NULL,
    usage_context text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(used_by_type) <> ''),
    CHECK (btrim(used_by_name) <> ''),
    CHECK (btrim(usage_context) <> ''),
    CHECK (used_by_type !~ '[[:cntrl:]]' AND used_by_name !~ '[[:cntrl:]]' AND usage_context !~ '[[:cntrl:]]'),
    UNIQUE(credential_id, used_by_type, used_by_name, usage_context)
);

CREATE TABLE IF NOT EXISTS connector_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL,
    name text NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    config jsonb NOT NULL DEFAULT '{}',
    last_sync_status text,
    last_sync_message text,
    last_synced_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (provider IN ('github', 'doppler', 's3', 'gcs', 'slack', 'resend')),
    CHECK (btrim(name) <> ''),
    CHECK (name !~ '[[:cntrl:]]'),
    CHECK (jsonb_typeof(config) = 'object'),
    CHECK (last_sync_status IS NULL OR last_sync_status IN ('ok', 'failed')),
    CHECK (last_sync_message IS NULL OR (btrim(last_sync_message) <> '' AND length(last_sync_message) <= 512 AND last_sync_message !~ '[[:cntrl:]]')),
    UNIQUE(provider, name)
);

CREATE TABLE IF NOT EXISTS audit_events (
    id bigserial PRIMARY KEY,
    actor text NOT NULL DEFAULT 'system',
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    target_name text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(actor) <> ''),
    CHECK (btrim(action) <> ''),
    CHECK (btrim(target_type) <> ''),
    CHECK (btrim(target_id) <> ''),
    CHECK (btrim(target_name) <> ''),
    CHECK (actor !~ '[[:cntrl:]]' AND action !~ '[[:cntrl:]]' AND target_type !~ '[[:cntrl:]]' AND target_id !~ '[[:cntrl:]]' AND target_name !~ '[[:cntrl:]]'),
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS deployments_application_created_idx ON deployments(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS proxy_routes_server_domain_idx ON proxy_routes(server_id, domain);
CREATE INDEX IF NOT EXISTS deployment_logs_deployment_created_idx ON deployment_logs(deployment_id, id);
CREATE INDEX IF NOT EXISTS credential_permissions_credential_idx ON credential_permissions(credential_id);
CREATE INDEX IF NOT EXISTS credential_usages_credential_idx ON credential_usages(credential_id);
CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events(created_at DESC);

INSERT INTO instance_settings (name, short_name, meta_description, logo_url, favicon_url, primary_color, docs_url)
SELECT 'Deploy Manager', 'Deploy', 'Internal deployment control plane', '/branding/prosights/prosights-co-logo.png', '/branding/prosights/favicon.png', '#0980fd', '#'
WHERE NOT EXISTS (SELECT 1 FROM instance_settings);
