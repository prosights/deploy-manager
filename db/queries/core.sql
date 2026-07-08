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
       p.repository_connector_id, p.repository_full_name, p.repository_branch,
       cr.name AS default_registry_name
FROM projects p
LEFT JOIN container_registries cr ON cr.id = p.default_registry_id
ORDER BY p.name;

-- name: CreateProjectWithDefaultEnvironments :one
WITH created_project AS (
    INSERT INTO projects (name, slug, description)
    VALUES ($1, $2, $3)
    RETURNING id, name, slug, description, created_at, updated_at, default_registry_id, repository_connector_id, repository_full_name, repository_branch
),
created_environments AS (
    INSERT INTO environments (project_id, name, slug, kind, is_ephemeral)
    SELECT id, 'Production', 'production', 'production', false FROM created_project
    UNION ALL
    SELECT id, 'Development', 'development', 'development', false FROM created_project
    RETURNING id
)
SELECT id, name, slug, description, created_at, updated_at, default_registry_id, repository_connector_id, repository_full_name, repository_branch
FROM created_project;

-- name: GetProject :one
SELECT id, name, slug, description, created_at, updated_at, default_registry_id, repository_connector_id, repository_full_name, repository_branch
FROM projects
WHERE id = $1;

-- name: UpdateProject :one
UPDATE projects
SET name = $2,
    slug = $3,
    description = $4,
    updated_at = now()
WHERE id = $1
RETURNING id, name, slug, description, created_at, updated_at, default_registry_id, repository_connector_id, repository_full_name, repository_branch;

-- name: DeleteProject :exec
DELETE FROM projects
WHERE id = $1;

-- name: UpdateProjectRegistry :one
UPDATE projects
SET default_registry_id = sqlc.narg(default_registry_id)::uuid,
    updated_at = now()
WHERE id = sqlc.arg(id)::uuid
RETURNING id, name, slug, description, created_at, updated_at, default_registry_id, repository_connector_id, repository_full_name, repository_branch;

-- name: UpdateProjectRepository :one
UPDATE projects
SET repository_connector_id = sqlc.narg(repository_connector_id)::uuid,
    repository_full_name = sqlc.narg(repository_full_name)::text,
    repository_branch = sqlc.narg(repository_branch)::text,
    updated_at = now()
WHERE id = sqlc.arg(id)::uuid
RETURNING id, name, slug, description, created_at, updated_at, default_registry_id, repository_connector_id, repository_full_name, repository_branch;

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

-- name: DeleteEnvironment :exec
DELETE FROM environments
WHERE id = $1;

-- name: CreateEnvironment :one
INSERT INTO environments (project_id, name, slug, kind, is_ephemeral, pull_request_number, branch, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, project_id, name, slug, kind, is_ephemeral, pull_request_number, branch, expires_at, created_at, updated_at;

-- name: ListApplications :many
SELECT a.id, a.environment_id, a.server_id, a.name, a.repository_url, a.branch, a.compose_path, a.remote_directory, a.domain, a.health_check_url, a.doppler_project, a.doppler_config, a.status, a.current_version, a.target_version, a.created_at, a.updated_at, a.github_auto_deploy,
       s.name AS server_name,
       e.name AS environment_name,
       e.slug AS environment_slug,
       e.kind AS environment_kind,
       e.is_ephemeral AS environment_is_ephemeral,
       p.id AS project_id,
       p.name AS project_name,
       p.slug AS project_slug,
       p.default_registry_id,
       cr.name AS default_registry_name
FROM applications a
JOIN servers s ON s.id = a.server_id
JOIN environments e ON e.id = a.environment_id
JOIN projects p ON p.id = e.project_id
LEFT JOIN container_registries cr ON cr.id = p.default_registry_id
ORDER BY a.name;

-- name: GetApplication :one
SELECT id, environment_id, server_id, name, repository_url, branch, compose_path, remote_directory, domain, health_check_url, doppler_project, doppler_config, status, current_version, target_version, created_at, updated_at, github_auto_deploy
FROM applications
WHERE id = $1;

-- name: DeleteApplication :exec
DELETE FROM applications
WHERE id = $1;

-- name: CreateApplication :one
INSERT INTO applications (environment_id, server_id, name, repository_url, branch, compose_path, remote_directory, domain, health_check_url, doppler_project, doppler_config, github_auto_deploy)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING id, environment_id, server_id, name, repository_url, branch, compose_path, remote_directory, domain, health_check_url, doppler_project, doppler_config, status, current_version, target_version, created_at, updated_at, github_auto_deploy;

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
    updated_at = now()
WHERE id = sqlc.arg(id)::uuid
RETURNING id, environment_id, server_id, name, repository_url, branch, compose_path, remote_directory, domain, health_check_url, doppler_project, doppler_config, status, current_version, target_version, created_at, updated_at, github_auto_deploy;

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
RETURNING id, environment_id, server_id, name, repository_url, branch, compose_path, remote_directory, domain, health_check_url, doppler_project, doppler_config, status, current_version, target_version, created_at, updated_at, github_auto_deploy;

-- name: ListDeployments :many
SELECT d.id, d.application_id, d.server_id, d.trigger, d.strategy, d.status, d.commit_sha, d.actor, d.started_at, d.finished_at, d.created_at, d.image_ref, d.image_digest,
       a.name AS application_name,
       s.name AS server_name
FROM deployments d
JOIN applications a ON a.id = d.application_id
JOIN servers s ON s.id = d.server_id
ORDER BY d.created_at DESC
LIMIT $1;

-- name: GetDeployment :one
SELECT id, application_id, server_id, trigger, strategy, status, commit_sha, actor, started_at, finished_at, created_at, image_ref, image_digest
FROM deployments
WHERE id = $1;

-- name: ListQueuedDeploymentsForRecovery :many
SELECT id, application_id, server_id, trigger, strategy, status, commit_sha, actor, started_at, finished_at, created_at, image_ref, image_digest
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
    RETURNING id, application_id, server_id, trigger, strategy, status, commit_sha, actor, started_at, finished_at, created_at, image_ref, image_digest
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
       a.repository_url,
       a.branch,
       a.compose_path,
       a.remote_directory,
       a.domain,
       a.health_check_url,
       a.doppler_project,
       a.doppler_config,
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
JOIN servers s ON s.id = d.server_id
WHERE d.id = $1;

-- name: CreateDeployment :one
INSERT INTO deployments (application_id, server_id, trigger, strategy, status, commit_sha, image_ref, image_digest, actor)
SELECT applications.id,
       applications.server_id,
       sqlc.arg(trigger)::text,
       sqlc.arg(strategy)::text,
       'queued',
       sqlc.narg(commit_sha)::text,
       sqlc.narg(image_ref)::text,
       sqlc.narg(image_digest)::text,
       sqlc.narg(actor)::text
FROM applications
WHERE applications.id = sqlc.arg(application_id)::uuid
RETURNING id, application_id, server_id, trigger, strategy, status, commit_sha, actor, started_at, finished_at, created_at, image_ref, image_digest;

-- name: UpdateDeploymentStatus :one
UPDATE deployments
SET status = $2,
    started_at = COALESCE(started_at, CASE WHEN $2 = 'running' THEN now() ELSE started_at END),
    finished_at = CASE WHEN $2 IN ('succeeded', 'failed', 'cancelled') THEN now() ELSE finished_at END
WHERE id = $1
RETURNING id, application_id, server_id, trigger, strategy, status, commit_sha, actor, started_at, finished_at, created_at, image_ref, image_digest;

-- name: StartQueuedDeployment :one
UPDATE deployments
SET status = 'running',
    started_at = COALESCE(started_at, now())
WHERE id = $1
  AND status = 'queued'
RETURNING id, application_id, server_id, trigger, strategy, status, commit_sha, actor, started_at, finished_at, created_at, image_ref, image_digest;

-- name: CancelQueuedDeployment :one
UPDATE deployments
SET status = 'cancelled',
    finished_at = now()
WHERE id = $1
  AND status = 'queued'
RETURNING id, application_id, server_id, trigger, strategy, status, commit_sha, actor, started_at, finished_at, created_at, image_ref, image_digest;

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
       s.name AS server_name,
       s.proxy_type,
       a.name AS application_name
FROM proxy_routes pr
JOIN servers s ON s.id = pr.server_id
LEFT JOIN applications a ON a.id = pr.application_id
ORDER BY pr.domain;

-- name: CreateProxyRoute :one
INSERT INTO proxy_routes (server_id, application_id, domain, upstream_url, tls_enabled, blue_upstream_url, green_upstream_url)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (server_id, domain) DO UPDATE
SET application_id = excluded.application_id,
    upstream_url = excluded.upstream_url,
    tls_enabled = excluded.tls_enabled,
    blue_upstream_url = excluded.blue_upstream_url,
    green_upstream_url = excluded.green_upstream_url,
    status = 'pending',
    updated_at = now()
RETURNING id, server_id, application_id, domain, upstream_url, tls_enabled, status, last_applied_at, created_at, updated_at, blue_upstream_url, green_upstream_url;

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
RETURNING id, server_id, application_id, domain, upstream_url, tls_enabled, status, last_applied_at, created_at, updated_at, blue_upstream_url, green_upstream_url;

-- name: UpdateProxyRouteUpstream :one
UPDATE proxy_routes
SET upstream_url = $2,
    status = 'pending',
    updated_at = now()
WHERE id = $1
RETURNING id, server_id, application_id, domain, upstream_url, tls_enabled, status, last_applied_at, created_at, updated_at, blue_upstream_url, green_upstream_url;

-- name: MarkProxyRouteFailed :one
UPDATE proxy_routes
SET status = 'failed', updated_at = now()
WHERE id = $1
RETURNING id, server_id, application_id, domain, upstream_url, tls_enabled, status, last_applied_at, created_at, updated_at, blue_upstream_url, green_upstream_url;

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

-- name: GetInstanceSettings :one
SELECT id, name, short_name, meta_description, logo_url, favicon_url, primary_color, docs_url, created_at, updated_at
FROM instance_settings
ORDER BY created_at
LIMIT 1;

-- name: UpdateInstanceSettings :one
UPDATE instance_settings
SET
    name = $1,
    short_name = $2,
    meta_description = $3,
    logo_url = $4,
    favicon_url = $5,
    primary_color = $6,
    docs_url = $7,
    updated_at = now()
WHERE id = (
    SELECT id
    FROM instance_settings
    ORDER BY created_at
    LIMIT 1
)
RETURNING id, name, short_name, meta_description, logo_url, favicon_url, primary_color, docs_url, created_at, updated_at;
