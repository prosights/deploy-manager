-- name: ListServers :many
SELECT id, name, hostname, ssh_user, ssh_port, ssh_key_path, connection_mode, proxy_type, status, cpu_usage, memory_usage, disk_usage, last_checked_at, created_at, updated_at
FROM servers
ORDER BY name;

-- name: CreateServer :one
INSERT INTO servers (name, hostname, ssh_user, ssh_port, ssh_key_path, connection_mode, proxy_type)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, name, hostname, ssh_user, ssh_port, ssh_key_path, connection_mode, proxy_type, status, cpu_usage, memory_usage, disk_usage, last_checked_at, created_at, updated_at;

-- name: CreateServerWithSSHInventory :one
WITH created_server AS (
    INSERT INTO servers (name, hostname, ssh_user, ssh_port, ssh_key_path, connection_mode, proxy_type)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, name, hostname, ssh_user, ssh_port, ssh_key_path, connection_mode, proxy_type, status, cpu_usage, memory_usage, disk_usage, last_checked_at, created_at, updated_at
),
ssh_credential AS (
    INSERT INTO credentials (name, provider, external_ref, credential_type, status, last_seen_at)
    SELECT created_server.name || ' SSH key', 'ssh', created_server.ssh_key_path, 'ssh_key', 'active', now()
    FROM created_server
    WHERE created_server.ssh_key_path IS NOT NULL
    ON CONFLICT (provider, external_ref) DO UPDATE
    SET name = excluded.name,
        credential_type = excluded.credential_type,
        status = excluded.status,
        last_seen_at = now(),
        updated_at = now()
    RETURNING id
),
ssh_permission AS (
    INSERT INTO credential_permissions (credential_id, resource_type, resource_name, permission, source)
    SELECT ssh_credential.id, 'server', created_server.name, 'ssh:connect', 'server registration'
    FROM ssh_credential
    CROSS JOIN created_server
    ON CONFLICT (credential_id, resource_type, resource_name, permission) DO UPDATE
    SET source = excluded.source
    RETURNING id
),
ssh_usage AS (
    INSERT INTO credential_usages (credential_id, used_by_type, used_by_name, usage_context)
    SELECT ssh_credential.id, 'server', created_server.name, 'remote access for deployments and health checks'
    FROM ssh_credential
    CROSS JOIN created_server
    ON CONFLICT (credential_id, used_by_type, used_by_name, usage_context) DO UPDATE
    SET usage_context = excluded.usage_context
    RETURNING id
)
SELECT id, name, hostname, ssh_user, ssh_port, ssh_key_path, connection_mode, proxy_type, status, cpu_usage, memory_usage, disk_usage, last_checked_at, created_at, updated_at
FROM created_server;

-- name: GetServer :one
SELECT id, name, hostname, ssh_user, ssh_port, ssh_key_path, connection_mode, proxy_type, status, cpu_usage, memory_usage, disk_usage, last_checked_at, created_at, updated_at
FROM servers
WHERE id = $1;

-- name: GetServerForUpdate :one
SELECT id, name, hostname, ssh_user, ssh_port, ssh_key_path, connection_mode, proxy_type, status, cpu_usage, memory_usage, disk_usage, last_checked_at, created_at, updated_at
FROM servers
WHERE id = $1
FOR UPDATE;

-- name: UpdateServerHealth :one
UPDATE servers
SET status = $2,
    cpu_usage = $3,
    memory_usage = $4,
    disk_usage = $5,
    ssh_key_path = CASE WHEN connection_mode = 'tailscale_ssh' THEN NULL ELSE ssh_key_path END,
    last_checked_at = now(),
    updated_at = now()
WHERE id = $1
RETURNING id, name, hostname, ssh_user, ssh_port, ssh_key_path, connection_mode, proxy_type, status, cpu_usage, memory_usage, disk_usage, last_checked_at, created_at, updated_at;

-- name: ListServerDevSudoUsers :many
SELECT id, server_id, username, created_at, updated_at
FROM server_dev_sudo_users
WHERE server_id = $1
ORDER BY username;

-- name: UpsertServerDevSudoUser :one
INSERT INTO server_dev_sudo_users (server_id, username)
VALUES ($1, $2)
ON CONFLICT (server_id, username) DO UPDATE
SET updated_at = now()
RETURNING id, server_id, username, created_at, updated_at;

-- name: RenameServerDevSudoUser :one
UPDATE server_dev_sudo_users
SET username = $3,
    updated_at = now()
WHERE server_id = $1
  AND username = $2
RETURNING id, server_id, username, created_at, updated_at;

-- name: DeleteServerDevSudoUser :exec
DELETE FROM server_dev_sudo_users
WHERE server_id = $1
  AND username = $2;

-- name: ReplaceServerDevSudoUsers :exec
WITH desired(username) AS (
    SELECT unnest(sqlc.arg(usernames)::text[])
),
deleted AS (
    DELETE FROM server_dev_sudo_users
    WHERE server_id = sqlc.arg(server_id)::uuid
      AND username NOT IN (SELECT username FROM desired)
)
INSERT INTO server_dev_sudo_users (server_id, username)
SELECT sqlc.arg(server_id)::uuid, desired.username
FROM desired
ON CONFLICT (server_id, username) DO UPDATE
SET updated_at = now();

-- name: ListProjects :many
SELECT p.id, p.name, p.slug, p.description, p.created_at, p.updated_at, p.default_registry_id,
       p.repository_connector_id, p.repository_full_name, p.repository_branch, p.configuration_revision,
       cr.name AS default_registry_name
FROM projects p
LEFT JOIN container_registries cr ON cr.id = p.default_registry_id
ORDER BY p.name;

-- name: CreateProjectWithDefaultEnvironments :one
WITH created_project AS (
    INSERT INTO projects (name, slug, description)
    VALUES ($1, $2, $3)
    RETURNING id, name, slug, description, created_at, updated_at, default_registry_id, repository_connector_id, repository_full_name, repository_branch, configuration_revision
),
created_environments AS (
    INSERT INTO environments (project_id, name, slug, kind, is_ephemeral)
    SELECT id, 'Production', 'production', 'production', false FROM created_project
    RETURNING id
)
SELECT id, name, slug, description, created_at, updated_at, default_registry_id, repository_connector_id, repository_full_name, repository_branch, configuration_revision
FROM created_project;

-- name: GetProject :one
SELECT id, name, slug, description, created_at, updated_at, default_registry_id, repository_connector_id, repository_full_name, repository_branch, configuration_revision
FROM projects
WHERE id = $1;

-- name: GetProjectForUpdate :one
SELECT id, name, slug, description, created_at, updated_at, default_registry_id, repository_connector_id, repository_full_name, repository_branch, configuration_revision
FROM projects
WHERE id = $1
FOR UPDATE;

-- name: UpdateProject :one
UPDATE projects
SET name = $2,
    slug = $3,
    description = $4,
    updated_at = now()
WHERE id = $1
RETURNING id, name, slug, description, created_at, updated_at, default_registry_id, repository_connector_id, repository_full_name, repository_branch, configuration_revision;

-- name: DeleteProject :exec
DELETE FROM projects
WHERE id = $1;

-- name: UpdateProjectRegistry :one
UPDATE projects
SET default_registry_id = sqlc.narg(default_registry_id)::uuid,
    updated_at = now()
WHERE id = sqlc.arg(id)::uuid
RETURNING id, name, slug, description, created_at, updated_at, default_registry_id, repository_connector_id, repository_full_name, repository_branch, configuration_revision;

-- name: UpdateProjectRepository :one
UPDATE projects
SET repository_connector_id = sqlc.narg(repository_connector_id)::uuid,
    repository_full_name = sqlc.narg(repository_full_name)::text,
    repository_branch = sqlc.narg(repository_branch)::text,
    updated_at = now()
WHERE id = sqlc.arg(id)::uuid
RETURNING id, name, slug, description, created_at, updated_at, default_registry_id, repository_connector_id, repository_full_name, repository_branch, configuration_revision;

-- name: ListProjectRuntimeVariables :many
SELECT project_id, key, value, created_at, updated_at
FROM project_runtime_variables
WHERE project_id = $1
ORDER BY key;

-- name: ListProjectRuntimeVariablesForApplication :many
SELECT variable.project_id, variable.key, variable.value, variable.created_at, variable.updated_at
FROM project_runtime_variables AS variable
JOIN environments AS environment ON environment.project_id = variable.project_id
JOIN applications AS application ON application.environment_id = environment.id
WHERE application.id = $1
ORDER BY variable.key;

-- name: DeleteProjectRuntimeVariables :exec
DELETE FROM project_runtime_variables
WHERE project_id = $1;

-- name: UpsertProjectRuntimeVariable :one
INSERT INTO project_runtime_variables (project_id, key, value)
VALUES ($1, $2, $3)
ON CONFLICT (project_id, key) DO UPDATE
SET value = excluded.value,
    updated_at = now()
RETURNING project_id, key, value, created_at, updated_at;

-- name: IncrementProjectConfigurationRevision :one
UPDATE projects
SET configuration_revision = configuration_revision + 1,
    updated_at = now()
WHERE id = $1
RETURNING configuration_revision;

-- name: ListEnvironments :many
SELECT e.id, e.project_id, e.name, e.slug, e.kind, e.is_ephemeral, e.pull_request_number, e.branch, e.expires_at, e.created_at, e.updated_at,
       p.name AS project_name,
       p.slug AS project_slug
FROM environments e
JOIN projects p ON p.id = e.project_id
ORDER BY p.name, CASE e.kind WHEN 'production' THEN 1 WHEN 'development' THEN 2 ELSE 3 END, e.name;

-- name: ListEnvironmentsForProject :many
SELECT id, project_id, name, slug, kind, is_ephemeral, pull_request_number, branch, expires_at, created_at, updated_at
FROM environments
WHERE project_id = $1
ORDER BY CASE kind WHEN 'production' THEN 1 WHEN 'development' THEN 2 ELSE 3 END, name;

-- name: GetEnvironment :one
SELECT id, project_id, name, slug, kind, is_ephemeral, pull_request_number, branch, expires_at, created_at, updated_at
FROM environments
WHERE id = $1;

-- name: DeleteEnvironment :one
DELETE FROM environments
WHERE environments.id = $1
  AND NOT EXISTS (
      SELECT 1
      FROM applications
      WHERE applications.environment_id = environments.id
  )
RETURNING environments.id;

-- name: CreateEnvironment :one
INSERT INTO environments (project_id, name, slug, kind, is_ephemeral, pull_request_number, branch, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, project_id, name, slug, kind, is_ephemeral, pull_request_number, branch, expires_at, created_at, updated_at;

-- name: ListApplications :many
SELECT a.id, a.environment_id, a.server_id, a.name, a.repository_url, a.branch, a.compose_path, a.remote_directory, a.domain, a.health_check_url, a.doppler_project, a.doppler_config, a.status, a.current_version, a.target_version, a.created_at, a.updated_at, a.github_auto_deploy,
       a.configuration_revision, a.deployed_configuration_revision, a.deployed_project_configuration_revision, a.compose_services,
       s.name AS server_name,
       e.name AS environment_name,
       e.slug AS environment_slug,
       e.kind AS environment_kind,
       e.is_ephemeral AS environment_is_ephemeral,
       p.id AS project_id,
       p.name AS project_name,
       p.slug AS project_slug,
       p.default_registry_id,
       (
           active_configuration.id IS NOT NULL
           AND CASE
               WHEN active_configuration.configuration_snapshot ? 'configuration_state'
                   THEN application_configuration_state(a.id) IS DISTINCT FROM active_configuration.configuration_snapshot->'configuration_state'
               ELSE a.configuration_revision > a.deployed_configuration_revision
                   OR p.configuration_revision > a.deployed_project_configuration_revision
           END
       ) AS redeploy_required,
       cr.name AS default_registry_name
FROM applications a
JOIN servers s ON s.id = a.server_id
JOIN environments e ON e.id = a.environment_id
JOIN projects p ON p.id = e.project_id
LEFT JOIN container_registries cr ON cr.id = p.default_registry_id
LEFT JOIN LATERAL (
    SELECT deployment.id, deployment.configuration_snapshot
    FROM deployments AS deployment
    LEFT JOIN application_deployment_slots AS slot
        ON slot.deployment_id = deployment.id
       AND slot.application_id = a.id
       AND slot.server_id = a.server_id
       AND slot.status = 'active'
    WHERE deployment.application_id = a.id
      AND deployment.status = 'succeeded'
    ORDER BY (slot.id IS NOT NULL) DESC,
             slot.updated_at DESC NULLS LAST,
             deployment.created_at DESC
    LIMIT 1
) AS active_configuration ON true
ORDER BY a.name;

-- name: GetApplication :one
SELECT id, environment_id, server_id, name, repository_url, branch, compose_path, remote_directory, domain, health_check_url, doppler_project, doppler_config, status, current_version, target_version, created_at, updated_at, github_auto_deploy, configuration_revision, deployed_configuration_revision, deployed_project_configuration_revision, compose_services
FROM applications
WHERE id = $1;

-- name: GetApplicationForUpdate :one
SELECT id, environment_id, server_id, name, repository_url, branch, compose_path, remote_directory, domain, health_check_url, doppler_project, doppler_config, status, current_version, target_version, created_at, updated_at, github_auto_deploy, configuration_revision, deployed_configuration_revision, deployed_project_configuration_revision, compose_services
FROM applications
WHERE id = $1
FOR UPDATE;

-- name: DeleteApplication :exec
DELETE FROM applications
WHERE id = $1;

-- name: GetApplicationDeletionState :one
SELECT EXISTS (
           SELECT 1
           FROM deployments
           WHERE deployments.application_id = sqlc.arg(application_id)::uuid
       ) AS has_deployments,
       EXISTS (
           SELECT 1
           FROM deployments
           WHERE deployments.application_id = sqlc.arg(application_id)::uuid
             AND deployments.status IN ('queued', 'running')
       ) AS deployment_in_progress;

-- name: CreateApplication :one
INSERT INTO applications (environment_id, server_id, name, repository_url, branch, compose_path, remote_directory, domain, health_check_url, doppler_project, doppler_config, github_auto_deploy)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING id, environment_id, server_id, name, repository_url, branch, compose_path, remote_directory, domain, health_check_url, doppler_project, doppler_config, status, current_version, target_version, created_at, updated_at, github_auto_deploy, configuration_revision, deployed_configuration_revision, deployed_project_configuration_revision, compose_services;

-- name: UpdateApplication :one
UPDATE applications
SET environment_id = sqlc.arg(environment_id)::uuid,
    server_id = sqlc.arg(server_id)::uuid,
    name = sqlc.arg(name)::text,
    repository_url = sqlc.narg(repository_url)::text,
    branch = sqlc.arg(branch)::text,
    compose_path = sqlc.arg(compose_path)::text,
    remote_directory = sqlc.arg(remote_directory)::text,
    domain = sqlc.narg(domain)::text,
    health_check_url = sqlc.narg(health_check_url)::text,
    doppler_project = sqlc.narg(doppler_project)::text,
    doppler_config = sqlc.narg(doppler_config)::text,
    github_auto_deploy = sqlc.arg(github_auto_deploy)::boolean,
    compose_services = sqlc.arg(compose_services)::jsonb,
    configuration_revision = CASE
        WHEN ROW(environment_id, server_id, name, repository_url, branch, compose_path, remote_directory, health_check_url, doppler_project, doppler_config, compose_services)
            IS DISTINCT FROM ROW(
                sqlc.arg(environment_id)::uuid,
                sqlc.arg(server_id)::uuid,
                sqlc.arg(name)::text,
                sqlc.narg(repository_url)::text,
                sqlc.arg(branch)::text,
                sqlc.arg(compose_path)::text,
                sqlc.arg(remote_directory)::text,
                sqlc.narg(health_check_url)::text,
                sqlc.narg(doppler_project)::text,
                sqlc.narg(doppler_config)::text,
                sqlc.arg(compose_services)::jsonb
            )
        THEN configuration_revision + 1
        ELSE configuration_revision
    END,
    updated_at = now()
WHERE id = sqlc.arg(id)::uuid
RETURNING id, environment_id, server_id, name, repository_url, branch, compose_path, remote_directory, domain, health_check_url, doppler_project, doppler_config, status, current_version, target_version, created_at, updated_at, github_auto_deploy, configuration_revision, deployed_configuration_revision, deployed_project_configuration_revision, compose_services;

-- name: ListApplicationsForGitHubPush :many
SELECT id, server_id, name, repository_url, branch, compose_path, health_check_url
FROM applications
WHERE branch = $1
  AND repository_url = ANY(sqlc.arg(repository_urls)::text[])
  AND github_auto_deploy = true
ORDER BY name;

-- name: ListApplicationsForBuildComplete :many
SELECT id, server_id, name, repository_url, branch, compose_path, health_check_url
FROM applications
WHERE branch = sqlc.arg(branch)::text
  AND github_auto_deploy = true
  AND (
    repository_url LIKE '%/' || sqlc.arg(repository)::text || '.git'
    OR repository_url LIKE '%/' || sqlc.arg(repository)::text
    OR repository_url LIKE '%:' || sqlc.arg(repository)::text || '.git'
    OR repository_url LIKE '%:' || sqlc.arg(repository)::text
  )
ORDER BY name;

-- name: UpdateApplicationStatus :one
UPDATE applications
SET status = sqlc.arg(status)::text,
    current_version = CASE
        WHEN sqlc.arg(status)::text = 'healthy' THEN COALESCE(sqlc.narg(version)::text, current_version)
        ELSE current_version
    END,
    target_version = CASE
        WHEN sqlc.arg(status)::text = 'deploying' THEN COALESCE(sqlc.narg(version)::text, target_version)
        WHEN sqlc.arg(status)::text = 'healthy' THEN NULL
        ELSE target_version
    END,
    updated_at = now()
WHERE id = sqlc.arg(id)::uuid
RETURNING id, environment_id, server_id, name, repository_url, branch, compose_path, remote_directory, domain, health_check_url, doppler_project, doppler_config, status, current_version, target_version, created_at, updated_at, github_auto_deploy, configuration_revision, deployed_configuration_revision, deployed_project_configuration_revision, compose_services;

-- name: MarkApplicationConfigurationDeployed :one
UPDATE applications
SET deployed_configuration_revision = GREATEST(deployed_configuration_revision, sqlc.arg(configuration_revision)::bigint),
    deployed_project_configuration_revision = GREATEST(deployed_project_configuration_revision, sqlc.arg(project_configuration_revision)::bigint)
WHERE id = sqlc.arg(id)::uuid
RETURNING id, environment_id, server_id, name, repository_url, branch, compose_path, remote_directory, domain, health_check_url, doppler_project, doppler_config, status, current_version, target_version, created_at, updated_at, github_auto_deploy, configuration_revision, deployed_configuration_revision, deployed_project_configuration_revision, compose_services;

-- name: UpdateApplicationComposeServices :one
UPDATE applications
SET compose_services = sqlc.arg(compose_services)::jsonb,
    configuration_revision = configuration_revision + 1,
    updated_at = now()
WHERE id = sqlc.arg(id)::uuid
  AND compose_services IS DISTINCT FROM sqlc.arg(compose_services)::jsonb
RETURNING id, environment_id, server_id, name, repository_url, branch, compose_path, remote_directory, domain, health_check_url, doppler_project, doppler_config, status, current_version, target_version, created_at, updated_at, github_auto_deploy, configuration_revision, deployed_configuration_revision, deployed_project_configuration_revision, compose_services;

-- name: BumpApplicationConfigurationRevision :exec
UPDATE applications
SET configuration_revision = configuration_revision + 1,
    updated_at = now()
WHERE id = $1;

-- name: ListApplicationServiceRuntimeConfigs :many
SELECT application_id, compose_service, doppler_project, doppler_config, variables, created_at, updated_at
FROM application_service_runtime_configs
WHERE application_id = $1
ORDER BY compose_service;

-- name: GetApplicationServiceRuntimeConfig :one
SELECT application_id, compose_service, doppler_project, doppler_config, variables, created_at, updated_at
FROM application_service_runtime_configs
WHERE application_id = sqlc.arg(application_id)::uuid
  AND compose_service = sqlc.arg(compose_service)::text;

-- name: UpsertApplicationServiceRuntimeConfig :one
INSERT INTO application_service_runtime_configs (application_id, compose_service, doppler_project, doppler_config, variables)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (application_id, compose_service) DO UPDATE
SET doppler_project = excluded.doppler_project,
    doppler_config = excluded.doppler_config,
    variables = excluded.variables,
    updated_at = now()
RETURNING application_id, compose_service, doppler_project, doppler_config, variables, created_at, updated_at;

-- name: DeleteApplicationServiceRuntimeConfig :exec
DELETE FROM application_service_runtime_configs
WHERE application_id = sqlc.arg(application_id)::uuid
  AND compose_service = sqlc.arg(compose_service)::text;

-- name: GetApplicationConfigurationRedeployCandidate :one
SELECT application.id AS application_id,
       application.name AS application_name,
       (
           EXISTS (
               SELECT 1
               FROM deployments AS successful_deployment
               WHERE successful_deployment.application_id = application.id
                 AND successful_deployment.status = 'succeeded'
           )
           AND CASE
               WHEN active_deployment.configuration_snapshot ? 'configuration_state'
                   THEN application_configuration_state(application.id) IS DISTINCT FROM active_deployment.configuration_snapshot->'configuration_state'
               ELSE application.configuration_revision > application.deployed_configuration_revision
                   OR project.configuration_revision > application.deployed_project_configuration_revision
           END
       ) AS redeploy_required,
       EXISTS (
           SELECT 1
           FROM deployments AS current_deployment
           WHERE current_deployment.application_id = application.id
             AND current_deployment.status IN ('queued', 'running')
       ) AS deployment_in_progress,
       active_deployment.id AS source_deployment_id,
       active_deployment.commit_sha AS source_commit_sha,
       active_deployment.image_ref AS source_image_ref,
       active_deployment.image_digest AS source_image_digest,
       active_deployment.source_repository_url,
       active_deployment.source_branch
FROM applications AS application
JOIN environments AS environment ON environment.id = application.environment_id
JOIN projects AS project ON project.id = environment.project_id
LEFT JOIN LATERAL (
    SELECT deployment.id,
           deployment.commit_sha,
           deployment.image_ref,
           deployment.image_digest,
           deployment.source_repository_url,
           deployment.source_branch,
           deployment.configuration_snapshot
    FROM deployments AS deployment
    LEFT JOIN application_deployment_slots AS slot
        ON slot.deployment_id = deployment.id
       AND slot.application_id = application.id
       AND slot.server_id = application.server_id
       AND slot.status = 'active'
    WHERE deployment.application_id = application.id
      AND deployment.status = 'succeeded'
    ORDER BY (slot.id IS NOT NULL) DESC,
             slot.updated_at DESC NULLS LAST,
             deployment.created_at DESC
    LIMIT 1
) AS active_deployment ON true
WHERE application.id = $1;

-- name: ListProjectConfigurationRedeployCandidates :many
SELECT application.id AS application_id,
       application.name AS application_name,
       EXISTS (
           SELECT 1
           FROM deployments AS current_deployment
           WHERE current_deployment.application_id = application.id
             AND current_deployment.status IN ('queued', 'running')
       ) AS deployment_in_progress,
       active_deployment.id AS source_deployment_id,
       active_deployment.commit_sha AS source_commit_sha,
       active_deployment.image_ref AS source_image_ref,
       active_deployment.image_digest AS source_image_digest,
       active_deployment.source_repository_url,
       active_deployment.source_branch
FROM applications AS application
JOIN environments AS environment ON environment.id = application.environment_id
JOIN projects AS project ON project.id = environment.project_id
LEFT JOIN LATERAL (
    SELECT deployment.id,
           deployment.commit_sha,
           deployment.image_ref,
           deployment.image_digest,
           deployment.source_repository_url,
           deployment.source_branch,
           deployment.configuration_snapshot
    FROM deployments AS deployment
    LEFT JOIN application_deployment_slots AS slot
        ON slot.deployment_id = deployment.id
       AND slot.application_id = application.id
       AND slot.server_id = application.server_id
       AND slot.status = 'active'
    WHERE deployment.application_id = application.id
      AND deployment.status = 'succeeded'
    ORDER BY (slot.id IS NOT NULL) DESC,
             slot.updated_at DESC NULLS LAST,
             deployment.created_at DESC
    LIMIT 1
) AS active_deployment ON true
WHERE environment.project_id = $1
  AND EXISTS (
      SELECT 1
      FROM deployments AS successful_deployment
      WHERE successful_deployment.application_id = application.id
        AND successful_deployment.status = 'succeeded'
  )
  AND CASE
      WHEN active_deployment.configuration_snapshot ? 'configuration_state'
          THEN application_configuration_state(application.id) IS DISTINCT FROM active_deployment.configuration_snapshot->'configuration_state'
      ELSE application.configuration_revision > application.deployed_configuration_revision
          OR project.configuration_revision > application.deployed_project_configuration_revision
  END
ORDER BY application.name, application.id;

-- name: ListDeployments :many
SELECT d.id, d.application_id, d.server_id, d.trigger, d.strategy, d.status, d.commit_sha, d.actor, d.started_at, d.finished_at, d.created_at, d.image_ref, d.image_digest, d.source_repository_url, d.source_branch, d.commit_message, d.configuration_snapshot,
       a.name AS application_name,
       s.name AS server_name
FROM deployments d
JOIN applications a ON a.id = d.application_id
JOIN servers s ON s.id = d.server_id
ORDER BY d.created_at DESC
LIMIT $1;

-- name: GetDeployment :one
SELECT id, application_id, server_id, trigger, strategy, status, commit_sha, actor, started_at, finished_at, created_at, image_ref, image_digest, source_repository_url, source_branch, commit_message, configuration_snapshot
FROM deployments
WHERE id = $1;

-- name: ListQueuedDeploymentsForRecovery :many
SELECT id, application_id, server_id, trigger, strategy, status, commit_sha, actor, started_at, finished_at, created_at, image_ref, image_digest, source_repository_url, source_branch, commit_message, configuration_snapshot
FROM deployments
WHERE status = 'queued'
ORDER BY created_at
LIMIT $1;

-- name: FailRunningDeploymentsForRecovery :many
WITH failed_deployments AS (
    UPDATE deployments
    SET status = 'failed',
        finished_at = now()
    WHERE status = 'running'
    RETURNING id, application_id, server_id, trigger, strategy, status, commit_sha, actor, started_at, finished_at, created_at, image_ref, image_digest, source_repository_url, source_branch, commit_message, configuration_snapshot
),
failed_applications AS (
    UPDATE applications
    SET status = 'failed',
        updated_at = now()
    WHERE id IN (SELECT application_id FROM failed_deployments)
    RETURNING id
)
SELECT failed_deployments.id,
       failed_deployments.application_id,
       failed_deployments.server_id,
       failed_deployments.trigger,
       failed_deployments.strategy,
       failed_deployments.status,
       failed_deployments.commit_sha,
       failed_deployments.image_ref,
       failed_deployments.image_digest,
       failed_deployments.source_repository_url,
       failed_deployments.source_branch,
       failed_deployments.commit_message,
       failed_deployments.configuration_snapshot,
       failed_deployments.actor,
       failed_deployments.started_at,
       failed_deployments.finished_at,
       failed_deployments.created_at
FROM failed_deployments;

-- name: GetDeploymentTarget :one
SELECT d.id AS deployment_id,
       d.strategy,
       d.commit_sha,
       d.image_ref,
       d.image_digest,
       a.id AS application_id,
       a.name AS application_name,
       d.source_repository_url AS repository_url,
       COALESCE(d.source_branch, a.branch) AS branch,
       a.compose_path,
       a.remote_directory,
       a.domain,
       a.health_check_url,
       a.doppler_project,
       a.doppler_config,
       a.compose_services,
       a.configuration_revision,
       p.configuration_revision AS project_configuration_revision,
       p.repository_connector_id,
       s.id AS server_id,
       s.name AS server_name,
       s.hostname,
       s.ssh_user,
       s.ssh_port,
       s.ssh_key_path,
       s.connection_mode,
       s.proxy_type
FROM deployments d
JOIN applications a ON a.id = d.application_id
JOIN environments e ON e.id = a.environment_id
JOIN projects p ON p.id = e.project_id
JOIN servers s ON s.id = d.server_id
WHERE d.id = $1;

-- name: CreateDeployment :one
INSERT INTO deployments (application_id, server_id, trigger, strategy, status, commit_sha, image_ref, image_digest, actor, source_repository_url, source_branch, configuration_snapshot)
SELECT applications.id,
       applications.server_id,
       sqlc.arg(trigger)::text,
       sqlc.arg(strategy)::text,
       'queued',
       sqlc.narg(commit_sha)::text,
       sqlc.narg(image_ref)::text,
       sqlc.narg(image_digest)::text,
       sqlc.narg(actor)::text,
       applications.repository_url,
       CASE WHEN applications.repository_url IS NULL THEN NULL ELSE applications.branch END,
       jsonb_build_object(
           'application_revision', applications.configuration_revision,
           'project_revision', projects.configuration_revision,
           'repository_url', applications.repository_url,
           'branch', applications.branch,
           'compose_path', applications.compose_path,
           'health_check_url', applications.health_check_url,
           'doppler_project', applications.doppler_project,
           'doppler_config', applications.doppler_config,
           'configuration_state', application_configuration_state(applications.id)
       )
FROM applications
JOIN environments ON environments.id = applications.environment_id
JOIN projects ON projects.id = environments.project_id
WHERE applications.id = sqlc.arg(application_id)::uuid
RETURNING id, application_id, server_id, trigger, strategy, status, commit_sha, actor, started_at, finished_at, created_at, image_ref, image_digest, source_repository_url, source_branch, commit_message, configuration_snapshot;

-- name: UpdateDeploymentStatus :one
UPDATE deployments
SET status = $2,
    started_at = COALESCE(started_at, CASE WHEN $2 = 'running' THEN now() ELSE started_at END),
    finished_at = CASE WHEN $2 IN ('succeeded', 'failed', 'cancelled') THEN now() ELSE finished_at END
WHERE id = $1
RETURNING id, application_id, server_id, trigger, strategy, status, commit_sha, actor, started_at, finished_at, created_at, image_ref, image_digest, source_repository_url, source_branch, commit_message, configuration_snapshot;

-- name: StartQueuedDeployment :one
UPDATE deployments
SET status = 'running',
    started_at = COALESCE(started_at, now())
WHERE id = $1
  AND status = 'queued'
RETURNING id, application_id, server_id, trigger, strategy, status, commit_sha, actor, started_at, finished_at, created_at, image_ref, image_digest, source_repository_url, source_branch, commit_message, configuration_snapshot;

-- name: SetDeploymentCommitSHA :one
UPDATE deployments
SET commit_sha = COALESCE(commit_sha, sqlc.arg(commit_sha)::text),
    commit_message = NULLIF(btrim(sqlc.arg(commit_message)::text), '')
WHERE id = sqlc.arg(deployment_id)::uuid
RETURNING id, application_id, server_id, trigger, strategy, status, commit_sha, actor, started_at, finished_at, created_at, image_ref, image_digest, source_repository_url, source_branch, commit_message, configuration_snapshot;

-- name: CancelQueuedDeployment :one
UPDATE deployments
SET status = 'cancelled',
    finished_at = now()
WHERE id = $1
  AND status = 'queued'
RETURNING id, application_id, server_id, trigger, strategy, status, commit_sha, actor, started_at, finished_at, created_at, image_ref, image_digest, source_repository_url, source_branch, commit_message, configuration_snapshot;

-- name: GetActiveDeploymentSlot :one
SELECT id, application_id, server_id, color, deployment_id, image_ref, image_digest, status, promoted_at, created_at, updated_at
FROM application_deployment_slots
WHERE application_id = $1
  AND server_id = $2
  AND status = 'active'
ORDER BY updated_at DESC
LIMIT 1;

-- name: GetStandbyDeploymentSlot :one
SELECT id, application_id, server_id, color, deployment_id, image_ref, image_digest, status, promoted_at, created_at, updated_at
FROM application_deployment_slots
WHERE application_id = $1
  AND server_id = $2
  AND status = 'standby'
ORDER BY updated_at DESC
LIMIT 1;

-- name: ListDeploymentSlotsForApplication :many
SELECT id, application_id, server_id, color, deployment_id, image_ref, image_digest, status, promoted_at, created_at, updated_at
FROM application_deployment_slots
WHERE application_id = $1
ORDER BY CASE status
    WHEN 'active' THEN 0
    WHEN 'standby' THEN 1
    ELSE 2
END,
updated_at DESC;

-- name: UpsertDeploymentSlot :one
INSERT INTO application_deployment_slots (application_id, server_id, color, deployment_id, image_ref, image_digest, status, promoted_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 = 'active' THEN now() ELSE NULL END)
ON CONFLICT (application_id, server_id, color) DO UPDATE
SET deployment_id = excluded.deployment_id,
    image_ref = excluded.image_ref,
    image_digest = excluded.image_digest,
    status = excluded.status,
    promoted_at = excluded.promoted_at,
    updated_at = now()
RETURNING id, application_id, server_id, color, deployment_id, image_ref, image_digest, status, promoted_at, created_at, updated_at;

-- name: ActivateDeploymentSlot :many
UPDATE application_deployment_slots
SET status = CASE WHEN color = sqlc.arg(color)::text THEN 'active' ELSE 'standby' END,
    promoted_at = CASE WHEN color = sqlc.arg(color)::text THEN now() ELSE promoted_at END,
    updated_at = now()
WHERE application_id = sqlc.arg(application_id)::uuid
  AND server_id = sqlc.arg(server_id)::uuid
  AND status IN ('active', 'standby')
RETURNING id, application_id, server_id, color, deployment_id, image_ref, image_digest, status, promoted_at, created_at, updated_at;

-- name: ListProxyRoutes :many
SELECT pr.id,
       pr.server_id,
       pr.application_id,
       pr.domain,
       pr.upstream_url,
       pr.tls_enabled,
       pr.status,
       pr.last_applied_at,
       pr.created_at,
       pr.updated_at,
       pr.blue_upstream_url,
       pr.green_upstream_url,
       pr.compose_service,
       pr.container_port,
       pr.port_variable,
       s.name AS server_name,
       s.proxy_type,
       a.name AS application_name
FROM proxy_routes pr
JOIN servers s ON s.id = pr.server_id
LEFT JOIN applications a ON a.id = pr.application_id
ORDER BY pr.domain;

-- name: CreateProxyRoute :one
INSERT INTO proxy_routes (server_id, application_id, domain, upstream_url, tls_enabled, blue_upstream_url, green_upstream_url, compose_service, container_port, port_variable)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (server_id, domain) DO UPDATE
SET application_id = excluded.application_id,
    upstream_url = excluded.upstream_url,
    tls_enabled = excluded.tls_enabled,
    blue_upstream_url = excluded.blue_upstream_url,
    green_upstream_url = excluded.green_upstream_url,
    compose_service = excluded.compose_service,
    container_port = excluded.container_port,
    port_variable = excluded.port_variable,
    status = 'pending',
    updated_at = now()
RETURNING id, server_id, application_id, domain, upstream_url, tls_enabled, status, last_applied_at, created_at, updated_at, blue_upstream_url, green_upstream_url, compose_service, container_port, port_variable;

-- name: ListProxyRoutesForServer :many
SELECT id, server_id, application_id, domain, upstream_url, tls_enabled, status, last_applied_at, created_at, updated_at, blue_upstream_url, green_upstream_url, compose_service, container_port, port_variable
FROM proxy_routes
WHERE server_id = $1
ORDER BY domain;

-- name: GetProxyRouteTarget :one
SELECT pr.id,
       pr.server_id,
       pr.application_id,
       pr.domain,
       pr.upstream_url,
       pr.tls_enabled,
       pr.status,
       pr.blue_upstream_url,
       pr.green_upstream_url,
       pr.compose_service,
       pr.container_port,
       pr.port_variable,
       s.name AS server_name,
       s.hostname,
       s.ssh_user,
       s.ssh_port,
       s.ssh_key_path,
       s.proxy_type
FROM proxy_routes pr
JOIN servers s ON s.id = pr.server_id
WHERE pr.id = $1;

-- name: DeleteProxyRoute :exec
DELETE FROM proxy_routes
WHERE id = $1;

-- name: ListProxyRouteTargetsForApplication :many
SELECT pr.id,
       pr.server_id,
       pr.application_id,
       pr.domain,
       pr.upstream_url,
       pr.tls_enabled,
       pr.status,
       pr.blue_upstream_url,
       pr.green_upstream_url,
       pr.compose_service,
       pr.container_port,
       pr.port_variable,
       s.name AS server_name,
       s.hostname,
       s.ssh_user,
       s.ssh_port,
       s.ssh_key_path,
       s.proxy_type
FROM proxy_routes pr
JOIN servers s ON s.id = pr.server_id
WHERE pr.application_id = $1
  AND pr.server_id = $2
ORDER BY pr.domain;

-- name: MarkProxyRouteApplied :one
UPDATE proxy_routes
SET status = 'applied', last_applied_at = now(), updated_at = now()
WHERE id = $1
RETURNING id, server_id, application_id, domain, upstream_url, tls_enabled, status, last_applied_at, created_at, updated_at, blue_upstream_url, green_upstream_url, compose_service, container_port, port_variable;

-- name: PromoteProxyRoutes :many
UPDATE proxy_routes AS route
SET upstream_url = desired.upstream_url,
    status = 'applied',
    last_applied_at = now(),
    updated_at = now()
FROM (
    SELECT unnest(sqlc.arg(route_ids)::uuid[]) AS id,
           unnest(sqlc.arg(upstream_urls)::text[]) AS upstream_url
) AS desired
WHERE route.id = desired.id
RETURNING route.id, route.server_id, route.application_id, route.domain, route.upstream_url, route.tls_enabled, route.status, route.last_applied_at, route.created_at, route.updated_at, route.blue_upstream_url, route.green_upstream_url, route.compose_service, route.container_port, route.port_variable;

-- name: UpdateProxyRouteUpstream :one
UPDATE proxy_routes
SET upstream_url = $2,
    status = 'pending',
    updated_at = now()
WHERE id = $1
RETURNING id, server_id, application_id, domain, upstream_url, tls_enabled, status, last_applied_at, created_at, updated_at, blue_upstream_url, green_upstream_url, compose_service, container_port, port_variable;

-- name: MarkProxyRouteFailed :one
UPDATE proxy_routes
SET status = 'failed', updated_at = now()
WHERE id = $1
RETURNING id, server_id, application_id, domain, upstream_url, tls_enabled, status, last_applied_at, created_at, updated_at, blue_upstream_url, green_upstream_url, compose_service, container_port, port_variable;

-- name: AppendDeploymentLog :one
INSERT INTO deployment_logs (deployment_id, stream, message)
VALUES ($1, $2, $3)
RETURNING id, deployment_id, stream, message, created_at;

-- name: ListRecentDeploymentLogs :many
SELECT id, deployment_id, stream, message, created_at
FROM (
    SELECT id, deployment_id, stream, message, created_at
    FROM deployment_logs
    WHERE deployment_id = sqlc.arg(deployment_id)
    ORDER BY id DESC
    LIMIT sqlc.arg(limit_count)
) recent
ORDER BY id;

-- name: ListDeploymentLogsAfter :many
SELECT id, deployment_id, stream, message, created_at
FROM deployment_logs
WHERE deployment_id = sqlc.arg(deployment_id) AND id > sqlc.arg(last_log_id)
ORDER BY id
LIMIT sqlc.arg(limit_count);

-- name: ListCredentials :many
SELECT c.id, c.name, c.provider, c.external_ref, c.credential_type, c.status, c.last_seen_at, c.created_at, c.updated_at,
       COALESCE(count(DISTINCT p.id), 0)::int AS permission_count,
       COALESCE(count(DISTINCT u.id), 0)::int AS usage_count
FROM credentials c
LEFT JOIN credential_permissions p ON p.credential_id = c.id
LEFT JOIN credential_usages u ON u.credential_id = c.id
GROUP BY c.id
ORDER BY c.provider, c.name;

-- name: GetCredential :one
SELECT id, name, provider, external_ref, credential_type, status, last_seen_at, created_at, updated_at
FROM credentials
WHERE id = $1;

-- name: GetCredentialWithCounts :one
SELECT c.id, c.name, c.provider, c.external_ref, c.credential_type, c.status, c.last_seen_at, c.created_at, c.updated_at,
       COALESCE(count(DISTINCT p.id), 0)::int AS permission_count,
       COALESCE(count(DISTINCT u.id), 0)::int AS usage_count
FROM credentials c
LEFT JOIN credential_permissions p ON p.credential_id = c.id
LEFT JOIN credential_usages u ON u.credential_id = c.id
WHERE c.id = $1
GROUP BY c.id;

-- name: UpsertCredential :one
INSERT INTO credentials (name, provider, external_ref, credential_type, status, last_seen_at)
VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT (provider, external_ref) DO UPDATE
SET name = excluded.name,
    credential_type = excluded.credential_type,
    status = excluded.status,
    last_seen_at = now(),
    updated_at = now()
RETURNING id, name, provider, external_ref, credential_type, status, last_seen_at, created_at, updated_at;

-- name: ListCredentialPermissions :many
SELECT id, credential_id, resource_type, resource_name, permission, source, created_at
FROM credential_permissions
WHERE credential_id = $1
ORDER BY resource_type, resource_name, permission;

-- name: UpsertCredentialPermission :one
INSERT INTO credential_permissions (credential_id, resource_type, resource_name, permission, source)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (credential_id, resource_type, resource_name, permission) DO UPDATE
SET source = excluded.source
RETURNING id, credential_id, resource_type, resource_name, permission, source, created_at;

-- name: DeleteCredentialPermissions :exec
DELETE FROM credential_permissions
WHERE credential_id = $1;

-- name: ListCredentialUsages :many
SELECT id, credential_id, used_by_type, used_by_name, usage_context, created_at
FROM credential_usages
WHERE credential_id = $1
ORDER BY used_by_type, used_by_name;

-- name: UpsertCredentialUsage :one
INSERT INTO credential_usages (credential_id, used_by_type, used_by_name, usage_context)
VALUES ($1, $2, $3, $4)
ON CONFLICT (credential_id, used_by_type, used_by_name, usage_context) DO UPDATE
SET usage_context = excluded.usage_context
RETURNING id, credential_id, used_by_type, used_by_name, usage_context, created_at;

-- name: DeleteCredentialUsages :exec
DELETE FROM credential_usages
WHERE credential_id = $1;

-- name: ListConnectorAccounts :many
SELECT id, provider, name, enabled, config, last_sync_status, last_sync_message, last_synced_at, created_at, updated_at
FROM connector_accounts
ORDER BY provider, name;

-- name: GetConnectorAccount :one
SELECT id, provider, name, enabled, config, last_sync_status, last_sync_message, last_synced_at, created_at, updated_at
FROM connector_accounts
WHERE id = $1;

-- name: UpsertConnectorAccount :one
INSERT INTO connector_accounts (provider, name, enabled, config)
VALUES ($1, $2, $3, $4)
ON CONFLICT (provider, name) DO UPDATE
SET enabled = excluded.enabled,
    config = excluded.config,
    last_sync_status = CASE
        WHEN connector_accounts.enabled IS DISTINCT FROM excluded.enabled OR connector_accounts.config IS DISTINCT FROM excluded.config THEN NULL
        ELSE connector_accounts.last_sync_status
    END,
    last_sync_message = CASE
        WHEN connector_accounts.enabled IS DISTINCT FROM excluded.enabled OR connector_accounts.config IS DISTINCT FROM excluded.config THEN NULL
        ELSE connector_accounts.last_sync_message
    END,
    last_synced_at = CASE
        WHEN connector_accounts.enabled IS DISTINCT FROM excluded.enabled OR connector_accounts.config IS DISTINCT FROM excluded.config THEN NULL
        ELSE connector_accounts.last_synced_at
    END,
    updated_at = now()
RETURNING id, provider, name, enabled, config, last_sync_status, last_sync_message, last_synced_at, created_at, updated_at;

-- name: MarkConnectorSync :one
INSERT INTO connector_accounts (provider, name, enabled, config, last_sync_status, last_sync_message, last_synced_at)
VALUES ($1, $2, true, '{}', $3, $4, now())
ON CONFLICT (provider, name) DO UPDATE
SET last_sync_status = excluded.last_sync_status,
    last_sync_message = excluded.last_sync_message,
    last_synced_at = now(),
    updated_at = now()
RETURNING id, provider, name, enabled, config, last_sync_status, last_sync_message, last_synced_at, created_at, updated_at;

-- name: ListBuildRuns :many
SELECT id, provider, connector_id, application_id, repository, branch, workflow_id, status, commit_sha, image_ref, image_digest, external_url, error_message, started_at, completed_at, created_at, updated_at
FROM build_runs
ORDER BY created_at DESC
LIMIT $1;

-- name: GetBuildRun :one
SELECT id, provider, connector_id, application_id, repository, branch, workflow_id, status, commit_sha, image_ref, image_digest, external_url, error_message, started_at, completed_at, created_at, updated_at
FROM build_runs
WHERE id = $1;

-- name: CreateBuildRun :one
INSERT INTO build_runs (provider, connector_id, application_id, repository, branch, workflow_id, status, commit_sha, started_at)
VALUES ($1, $2, $3, $4, $5, $6, 'dispatched', $7, now())
RETURNING id, provider, connector_id, application_id, repository, branch, workflow_id, status, commit_sha, image_ref, image_digest, external_url, error_message, started_at, completed_at, created_at, updated_at;

-- name: CompleteBuildRun :one
UPDATE build_runs
SET status = $2,
    image_ref = sqlc.narg(image_ref)::text,
    image_digest = sqlc.narg(image_digest)::text,
    external_url = sqlc.narg(external_url)::text,
    error_message = sqlc.narg(error_message)::text,
    completed_at = now(),
    updated_at = now()
WHERE id = $1
  AND status <> 'succeeded'
RETURNING id, provider, connector_id, application_id, repository, branch, workflow_id, status, commit_sha, image_ref, image_digest, external_url, error_message, started_at, completed_at, created_at, updated_at;

-- name: ListContainerRegistries :many
SELECT id, name, provider, registry_host, namespace, repository, default_image, enabled, created_at, updated_at
FROM container_registries
ORDER BY enabled DESC, name;

-- name: GetContainerRegistry :one
SELECT id, name, provider, registry_host, namespace, repository, default_image, enabled, created_at, updated_at
FROM container_registries
WHERE id = $1;

-- name: UpsertContainerRegistry :one
INSERT INTO container_registries (name, provider, registry_host, namespace, repository, default_image, enabled)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (name) DO UPDATE
SET provider = excluded.provider,
    registry_host = excluded.registry_host,
    namespace = excluded.namespace,
    repository = excluded.repository,
    default_image = excluded.default_image,
    enabled = excluded.enabled,
    updated_at = now()
RETURNING id, name, provider, registry_host, namespace, repository, default_image, enabled, created_at, updated_at;

-- name: ListAuditEvents :many
SELECT id, actor, action, target_type, target_id, target_name, metadata, created_at
FROM audit_events
ORDER BY created_at DESC
LIMIT $1;

-- name: AppendAuditEvent :one
INSERT INTO audit_events (actor, action, target_type, target_id, target_name, metadata)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, actor, action, target_type, target_id, target_name, metadata, created_at;
