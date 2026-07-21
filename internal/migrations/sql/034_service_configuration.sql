-- Additive only: the currently deployed binary remains compatible with this
-- schema, so a failed Deploy Manager release can roll back safely.
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS configuration_revision bigint NOT NULL DEFAULT 0;

ALTER TABLE applications
    ADD COLUMN IF NOT EXISTS configuration_revision bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS deployed_configuration_revision bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS deployed_project_configuration_revision bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS compose_services jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_compose_services_array;
ALTER TABLE applications ADD CONSTRAINT applications_compose_services_array
    CHECK (jsonb_typeof(compose_services) = 'array');

ALTER TABLE deployments
    ADD COLUMN IF NOT EXISTS source_repository_url text,
    ADD COLUMN IF NOT EXISTS source_branch text,
    ADD COLUMN IF NOT EXISTS commit_message text,
    ADD COLUMN IF NOT EXISTS configuration_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE deployments DROP CONSTRAINT IF EXISTS deployments_commit_message_clean;
ALTER TABLE deployments ADD CONSTRAINT deployments_commit_message_clean
    CHECK (commit_message IS NULL OR (length(commit_message) <= 500 AND commit_message !~ '[[:cntrl:]]'));

ALTER TABLE deployments DROP CONSTRAINT IF EXISTS deployments_configuration_snapshot_object;
ALTER TABLE deployments ADD CONSTRAINT deployments_configuration_snapshot_object
    CHECK (jsonb_typeof(configuration_snapshot) = 'object');

UPDATE deployments AS deployment
SET source_repository_url = application.repository_url,
    source_branch = CASE WHEN application.repository_url IS NULL THEN NULL ELSE application.branch END
FROM applications AS application
WHERE application.id = deployment.application_id
  AND deployment.source_repository_url IS NULL;

CREATE TABLE IF NOT EXISTS project_runtime_variables (
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key text NOT NULL,
    value text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, key),
    CHECK (key ~ '^[A-Za-z_][A-Za-z0-9_]*$'),
    CHECK (length(key) <= 128),
    CHECK (length(value) <= 8192),
    CHECK (value !~ '[[:cntrl:]]')
);

CREATE TABLE IF NOT EXISTS application_service_runtime_configs (
    application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    compose_service text NOT NULL,
    doppler_project text,
    doppler_config text,
    variables jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (application_id, compose_service),
    CHECK (btrim(compose_service) <> ''),
    CHECK (length(compose_service) <= 128),
    CHECK (compose_service ~ '^[A-Za-z0-9_.-]+$'),
    CHECK (doppler_project IS NULL OR (btrim(doppler_project) <> '' AND doppler_project !~ '[[:cntrl:]]')),
    CHECK (doppler_config IS NULL OR (btrim(doppler_config) <> '' AND doppler_config !~ '[[:cntrl:]]')),
    CHECK ((doppler_project IS NULL AND doppler_config IS NULL) OR (doppler_project IS NOT NULL AND doppler_config IS NOT NULL)),
    CHECK (jsonb_typeof(variables) = 'array')
);

-- Keep a canonical, non-secret deployment state in each deployment snapshot.
-- Comparing this JSON lets a reverted edit become clean again without trying
-- to infer state from monotonically increasing revision numbers.
CREATE OR REPLACE FUNCTION application_configuration_state(target_application_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
    SELECT jsonb_build_object(
        'application', jsonb_build_object(
            'environment_id', application.environment_id,
            'server_id', application.server_id,
            'name', application.name,
            'repository_url', application.repository_url,
            'branch', application.branch,
            'compose_path', application.compose_path,
            'remote_directory', application.remote_directory,
            'health_check_url', application.health_check_url,
            'doppler_project', application.doppler_project,
            'doppler_config', application.doppler_config,
            'compose_services', application.compose_services
        ),
        'project_variables', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object('key', variable.key, 'value', variable.value)
                ORDER BY variable.key
            )
            FROM project_runtime_variables AS variable
            WHERE variable.project_id = environment.project_id
        ), '[]'::jsonb),
        'service_runtime_configs', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'compose_service', config.compose_service,
                    'doppler_project', config.doppler_project,
                    'doppler_config', config.doppler_config,
                    'variables', config.variables
                )
                ORDER BY config.compose_service
            )
            FROM application_service_runtime_configs AS config
            WHERE config.application_id = application.id
        ), '[]'::jsonb)
    )
    FROM applications AS application
    JOIN environments AS environment ON environment.id = application.environment_id
    WHERE application.id = target_application_id
$function$;

ALTER TABLE proxy_routes
    ADD COLUMN IF NOT EXISTS compose_service text,
    ADD COLUMN IF NOT EXISTS container_port integer,
    ADD COLUMN IF NOT EXISTS port_variable text;

ALTER TABLE proxy_routes DROP CONSTRAINT IF EXISTS proxy_routes_compose_service_valid;
ALTER TABLE proxy_routes ADD CONSTRAINT proxy_routes_compose_service_valid
    CHECK (
        compose_service IS NULL
        OR (
            btrim(compose_service) <> ''
            AND length(compose_service) <= 128
            AND compose_service ~ '^[A-Za-z0-9_.-]+$'
        )
    );

ALTER TABLE proxy_routes DROP CONSTRAINT IF EXISTS proxy_routes_container_port_valid;
ALTER TABLE proxy_routes ADD CONSTRAINT proxy_routes_container_port_valid
    CHECK (container_port IS NULL OR container_port BETWEEN 1 AND 65535);

ALTER TABLE proxy_routes DROP CONSTRAINT IF EXISTS proxy_routes_port_variable_valid;
ALTER TABLE proxy_routes ADD CONSTRAINT proxy_routes_port_variable_valid
    CHECK (port_variable IS NULL OR port_variable ~ '^[A-Z_][A-Z0-9_]{0,127}$');
