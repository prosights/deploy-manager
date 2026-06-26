package migrations

import (
	"bytes"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func TestMigrationNamesAreSorted(t *testing.T) {
	names, err := migrationNames()
	if err != nil {
		t.Fatal(err)
	}
	if len(names) == 0 {
		t.Fatal("expected embedded migrations")
	}
	if names[0] != "001_initial.sql" {
		t.Fatalf("expected initial migration first, got %q", names[0])
	}
}

func TestEmbeddedMigrationsMatchRootMigrations(t *testing.T) {
	names, err := migrationNames()
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range names {
		embedded, err := files.ReadFile("sql/" + name)
		if err != nil {
			t.Fatal(err)
		}
		root, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", name))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(embedded, root) {
			t.Fatalf("embedded migration %s drifted from db/migrations/%s", name, name)
		}
	}
}

func TestRootMigrationsAreEmbedded(t *testing.T) {
	embedded, err := migrationNames()
	if err != nil {
		t.Fatal(err)
	}
	root, err := rootMigrationNames()
	if err != nil {
		t.Fatal(err)
	}
	if !equalStrings(embedded, root) {
		t.Fatalf("expected embedded migrations %+v to match root migrations %+v", embedded, root)
	}
}

func TestMigrationLockUsesTransactionScopedAdvisoryLock(t *testing.T) {
	got := migrationLockSQL()
	if !strings.Contains(got, "pg_advisory_xact_lock") {
		t.Fatalf("expected transaction-scoped advisory lock, got %q", got)
	}
	if !strings.Contains(got, "9021001") {
		t.Fatalf("expected stable migration lock id, got %q", got)
	}
}

func TestInitialMigrationCarriesDeploymentGuardrails(t *testing.T) {
	migration, err := files.ReadFile("sql/001_initial.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	for _, expected := range []string{
		"CHECK (btrim(name) <> '')",
		"CHECK (btrim(short_name) <> '')",
		"CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$')",
		"CHECK (logo_url = '' OR logo_url ~ '^data:image/' OR logo_url ~* '[.](svg|png|jpg|jpeg|webp|gif)([?#].*)?$')",
		"CHECK (favicon_url = '' OR favicon_url ~ '^data:image/' OR favicon_url ~* '[.](ico|png|svg)([?#].*)?$')",
		"CHECK (name !~ '[[:cntrl:]]' AND short_name !~ '[[:cntrl:]]' AND meta_description !~ '[[:cntrl:]]' AND logo_url !~ '[[:cntrl:]]' AND favicon_url !~ '[[:cntrl:]]' AND primary_color !~ '[[:cntrl:]]' AND docs_url !~ '[[:cntrl:]]')",
		"CHECK (ssh_key_path IS NOT NULL AND btrim(ssh_key_path) <> '')",
		"CHECK (left(btrim(ssh_key_path), 1) = '/' OR left(btrim(ssh_key_path), 2) = '~/')",
		"CHECK (btrim(ssh_key_path) !~ '//')",
		"CHECK (btrim(ssh_key_path) !~ '(^|/)\\.\\.(/|$)')",
		"CHECK (name !~ '[[:cntrl:]]' AND hostname !~ '[[:cntrl:]]' AND ssh_user !~ '[[:cntrl:]]' AND ssh_key_path !~ '[[:cntrl:]]')",
		"CHECK (ssh_port BETWEEN 1 AND 65535)",
		"CHECK (cpu_usage IS NULL OR (cpu_usage >= 0 AND cpu_usage <= 100))",
		"CHECK (memory_usage IS NULL OR (memory_usage >= 0 AND memory_usage <= 100))",
		"CHECK (disk_usage IS NULL OR (disk_usage >= 0 AND disk_usage <= 100))",
		"CHECK (repository_url IS NULL OR repository_url ~ '^(git@github[.]com:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+[.]git|https://github[.]com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+([.]git)?)$')",
		"CHECK (btrim(branch) !~ '^-')",
		"CHECK (btrim(branch) !~ '(^/|/$|//)')",
		"CHECK (btrim(branch) !~ '(\\.\\.|\\.lock$|\\.$)')",
		"CHECK (btrim(branch) ~ '^[A-Za-z0-9._/-]+$')",
		"CHECK (btrim(remote_directory) <> '' AND left(btrim(remote_directory), 1) = '/' AND btrim(remote_directory) <> '/')",
		"CHECK (btrim(remote_directory) !~ '//')",
		"CHECK (btrim(remote_directory) !~ '(^|/)\\.\\.(/|$)')",
		"CHECK (btrim(compose_path) <> '.')",
		"CHECK (left(btrim(compose_path), 1) <> '/')",
		"CHECK (btrim(compose_path) !~ '(^|/)\\.\\.(/|$)')",
		"CHECK (health_check_url IS NULL OR (btrim(health_check_url) <> '' AND health_check_url ~ '^https?://' AND health_check_url !~ '[[:cntrl:]]' AND health_check_url !~ '^https?://[^/@]+@'))",
		"CHECK (doppler_project IS NULL OR (btrim(doppler_project) <> '' AND doppler_project !~ '[[:cntrl:]]'))",
		"CHECK (doppler_config IS NULL OR (btrim(doppler_config) <> '' AND doppler_config !~ '[[:cntrl:]]'))",
		"CHECK ((doppler_project IS NULL AND doppler_config IS NULL) OR (doppler_project IS NOT NULL AND doppler_config IS NOT NULL))",
		"CHECK (trigger IN ('manual', 'github_push', 'connector_sync', 'retry'))",
		"CHECK (commit_sha IS NULL OR commit_sha ~ '^[0-9A-Fa-f]{7,40}$')",
		"CHECK (actor IS NULL OR actor !~ '[[:cntrl:]]')",
		"CHECK ((status = 'queued' AND started_at IS NULL AND finished_at IS NULL) OR status <> 'queued')",
		"CHECK ((status = 'running' AND started_at IS NOT NULL AND finished_at IS NULL) OR status <> 'running')",
		"CHECK ((status IN ('succeeded', 'failed', 'cancelled') AND finished_at IS NOT NULL) OR status NOT IN ('succeeded', 'failed', 'cancelled'))",
		"CHECK (btrim(message) <> '')",
		"CHECK (length(message) <= 32768)",
		"CHECK (btrim(domain) <> '')",
		"CHECK (domain = lower(domain))",
		"CHECK (length(domain) <= 253)",
		"CHECK (domain ~ '^[a-z0-9.-]+$')",
		"CHECK (domain !~ '(^|[.])-|-(\\.|$)|[.]{2}')",
		"CHECK (btrim(upstream_url) <> '')",
		"CHECK (upstream_url ~ '^https?://')",
		"CHECK (upstream_url !~ '[[:cntrl:]]')",
		"CHECK (upstream_url !~ '^https?://[^/@]+@')",
		"CHECK (upstream_url ~ '^https?://[^/?#]+/?$')",
		"CHECK (provider IN ('github', 'doppler', 's3', 'gcs', 'slack', 'resend', 'ssh'))",
		"CHECK (btrim(external_ref) <> '')",
		"CHECK (btrim(credential_type) <> '')",
		"CHECK (name !~ '[[:cntrl:]]' AND external_ref !~ '[[:cntrl:]]' AND credential_type !~ '[[:cntrl:]]')",
		"CHECK (btrim(resource_type) <> '')",
		"CHECK (btrim(resource_name) <> '')",
		"CHECK (btrim(permission) <> '')",
		"CHECK (resource_type !~ '[[:cntrl:]]' AND resource_name !~ '[[:cntrl:]]' AND permission !~ '[[:cntrl:]]' AND source !~ '[[:cntrl:]]')",
		"CHECK (btrim(used_by_type) <> '')",
		"CHECK (btrim(used_by_name) <> '')",
		"CHECK (btrim(usage_context) <> '')",
		"CHECK (used_by_type !~ '[[:cntrl:]]' AND used_by_name !~ '[[:cntrl:]]' AND usage_context !~ '[[:cntrl:]]')",
		"CHECK (provider IN ('github', 'doppler', 's3', 'gcs', 'slack', 'resend'))",
		"CHECK (btrim(name) <> '')",
		"CHECK (name !~ '[[:cntrl:]]')",
		"CHECK (jsonb_typeof(config) = 'object')",
		"CHECK (last_sync_status IS NULL OR last_sync_status IN ('ok', 'failed'))",
		"CHECK (last_sync_message IS NULL OR (btrim(last_sync_message) <> '' AND length(last_sync_message) <= 512 AND last_sync_message !~ '[[:cntrl:]]'))",
		"CHECK (btrim(actor) <> '')",
		"CHECK (btrim(action) <> '')",
		"CHECK (btrim(target_type) <> '')",
		"CHECK (btrim(target_id) <> '')",
		"CHECK (btrim(target_name) <> '')",
		"CHECK (actor !~ '[[:cntrl:]]' AND action !~ '[[:cntrl:]]' AND target_type !~ '[[:cntrl:]]' AND target_id !~ '[[:cntrl:]]' AND target_name !~ '[[:cntrl:]]')",
		"CHECK (jsonb_typeof(metadata) = 'object')",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("expected initial migration to contain %q", expected)
		}
	}
}

func TestServerSSHKeyPathRequirementHasForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/003_require_server_ssh_key_path.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	if !strings.Contains(sql, "servers_ssh_key_path_required") {
		t.Fatalf("expected named SSH key path constraint, got %s", sql)
	}
	if !strings.Contains(sql, "CHECK (ssh_key_path IS NOT NULL AND btrim(ssh_key_path) <> '') NOT VALID") {
		t.Fatalf("expected future-write SSH key path guardrail, got %s", sql)
	}
}

func TestServerSSHKeyPathShapeRequirementsHaveForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/018_restrict_server_ssh_key_paths.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	for _, expected := range []string{
		"servers_ssh_key_path_location",
		"servers_ssh_key_path_no_empty_segments",
		"servers_ssh_key_path_no_parent_segments",
		"CHECK (left(btrim(ssh_key_path), 1) = '/' OR left(btrim(ssh_key_path), 2) = '~/') NOT VALID",
		"CHECK (btrim(ssh_key_path) !~ '//') NOT VALID",
		"CHECK (btrim(ssh_key_path) !~ '(^|/)\\.\\.(/|$)') NOT VALID",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("expected server SSH key path guardrail %q, got %s", expected, sql)
		}
	}
}

func TestServerIdentityControlCharacterRequirementHasForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/012_restrict_server_identity_control_characters.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	if !strings.Contains(sql, "servers_identity_no_control_characters") {
		t.Fatalf("expected named server identity constraint, got %s", sql)
	}
	if !strings.Contains(sql, "CHECK (name !~ '[[:cntrl:]]' AND hostname !~ '[[:cntrl:]]' AND ssh_user !~ '[[:cntrl:]]' AND ssh_key_path !~ '[[:cntrl:]]') NOT VALID") {
		t.Fatalf("expected future-write server identity guardrail, got %s", sql)
	}
}

func TestServerResourceMetricRequirementsHaveForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/015_restrict_server_resource_metrics.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	for _, expected := range []string{
		"servers_cpu_usage_percentage",
		"servers_memory_usage_percentage",
		"servers_disk_usage_percentage",
		"CHECK (cpu_usage IS NULL OR (cpu_usage >= 0 AND cpu_usage <= 100)) NOT VALID",
		"CHECK (memory_usage IS NULL OR (memory_usage >= 0 AND memory_usage <= 100)) NOT VALID",
		"CHECK (disk_usage IS NULL OR (disk_usage >= 0 AND disk_usage <= 100)) NOT VALID",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("expected server resource metric guardrail %q, got %s", expected, sql)
		}
	}
}

func TestApplicationRepositoryURLRequirementHasForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/004_restrict_application_repository_urls.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	if !strings.Contains(sql, "applications_repository_url_github_remote") {
		t.Fatalf("expected named repository URL constraint, got %s", sql)
	}
	if !strings.Contains(sql, "CHECK (repository_url IS NULL OR repository_url ~ '^(git@github[.]com:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+[.]git|https://github[.]com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+([.]git)?)$') NOT VALID") {
		t.Fatalf("expected future-write repository URL guardrail, got %s", sql)
	}
}

func TestProxyUpstreamControlCharacterRequirementHasForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/005_restrict_proxy_upstream_control_characters.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	if !strings.Contains(sql, "proxy_routes_upstream_url_no_control_characters") {
		t.Fatalf("expected named proxy upstream constraint, got %s", sql)
	}
	if !strings.Contains(sql, "CHECK (upstream_url !~ '[[:cntrl:]]') NOT VALID") {
		t.Fatalf("expected future-write proxy upstream guardrail, got %s", sql)
	}
}

func TestCredentialInventoryControlCharacterRequirementsHaveForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/006_restrict_credential_inventory_control_characters.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	for _, expected := range []string{
		"credentials_identity_no_control_characters",
		"credential_permissions_no_control_characters",
		"credential_usages_no_control_characters",
		"CHECK (name !~ '[[:cntrl:]]' AND external_ref !~ '[[:cntrl:]]' AND credential_type !~ '[[:cntrl:]]') NOT VALID",
		"CHECK (resource_type !~ '[[:cntrl:]]' AND resource_name !~ '[[:cntrl:]]' AND permission !~ '[[:cntrl:]]' AND source !~ '[[:cntrl:]]') NOT VALID",
		"CHECK (used_by_type !~ '[[:cntrl:]]' AND used_by_name !~ '[[:cntrl:]]' AND usage_context !~ '[[:cntrl:]]') NOT VALID",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("expected credential inventory guardrail %q, got %s", expected, sql)
		}
	}
}

func TestDeploymentActorControlCharacterRequirementHasForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/007_restrict_deployment_actor_control_characters.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	if !strings.Contains(sql, "deployments_actor_no_control_characters") {
		t.Fatalf("expected named deployment actor constraint, got %s", sql)
	}
	if !strings.Contains(sql, "CHECK (actor IS NULL OR actor !~ '[[:cntrl:]]') NOT VALID") {
		t.Fatalf("expected future-write deployment actor guardrail, got %s", sql)
	}
}

func TestDeploymentStatusTimestampRequirementsHaveForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/020_restrict_deployment_status_timestamps.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	for _, expected := range []string{
		"deployments_queued_has_no_runtime_timestamps",
		"deployments_running_has_started_timestamp",
		"deployments_terminal_has_finished_timestamp",
		"CHECK ((status = 'queued' AND started_at IS NULL AND finished_at IS NULL) OR status <> 'queued') NOT VALID",
		"CHECK ((status = 'running' AND started_at IS NOT NULL AND finished_at IS NULL) OR status <> 'running') NOT VALID",
		"CHECK ((status IN ('succeeded', 'failed', 'cancelled') AND finished_at IS NOT NULL) OR status NOT IN ('succeeded', 'failed', 'cancelled')) NOT VALID",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("expected deployment timestamp guardrail %q, got %s", expected, sql)
		}
	}
}

func TestProxyUpstreamOriginURLRequirementHasForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/009_restrict_proxy_upstream_origin_urls.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	if !strings.Contains(sql, "proxy_routes_upstream_url_origin_only") {
		t.Fatalf("expected named proxy upstream origin constraint, got %s", sql)
	}
	if !strings.Contains(sql, "CHECK (upstream_url ~ '^https?://[^/?#]+/?$') NOT VALID") {
		t.Fatalf("expected future-write proxy upstream origin guardrail, got %s", sql)
	}
}

func TestProxyRouteDomainRequirementsHaveForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/014_restrict_proxy_route_domains.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	for _, expected := range []string{
		"proxy_routes_domain_lowercase",
		"proxy_routes_domain_length",
		"proxy_routes_domain_allowed_characters",
		"proxy_routes_domain_label_boundaries",
		"CHECK (domain = lower(domain)) NOT VALID",
		"CHECK (length(domain) <= 253) NOT VALID",
		"CHECK (domain ~ '^[a-z0-9.-]+$') NOT VALID",
		"CHECK (domain !~ '(^|[.])-|-(\\.|$)|[.]{2}') NOT VALID",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("expected proxy domain guardrail %q, got %s", expected, sql)
		}
	}
}

func TestApplicationHealthCheckURLControlCharacterRequirementHasForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/011_restrict_application_health_check_control_characters.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	if !strings.Contains(sql, "applications_health_check_url_no_control_characters") {
		t.Fatalf("expected named application health check constraint, got %s", sql)
	}
	if !strings.Contains(sql, "CHECK (health_check_url IS NULL OR health_check_url !~ '[[:cntrl:]]') NOT VALID") {
		t.Fatalf("expected future-write health check guardrail, got %s", sql)
	}
}

func TestApplicationDopplerScopeRequirementHasForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/017_restrict_application_doppler_scope.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	for _, expected := range []string{
		"applications_doppler_project_clean",
		"applications_doppler_config_clean",
		"CHECK (doppler_project IS NULL OR (btrim(doppler_project) <> '' AND doppler_project !~ '[[:cntrl:]]')) NOT VALID",
		"CHECK (doppler_config IS NULL OR (btrim(doppler_config) <> '' AND doppler_config !~ '[[:cntrl:]]')) NOT VALID",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("expected Doppler scope guardrail %q, got %s", expected, sql)
		}
	}
}

func TestDeploymentLogMessageLengthRequirementHasForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/013_restrict_deployment_log_messages.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	if !strings.Contains(sql, "deployment_logs_message_length") {
		t.Fatalf("expected named deployment log message constraint, got %s", sql)
	}
	if !strings.Contains(sql, "CHECK (length(message) <= 32768) NOT VALID") {
		t.Fatalf("expected future-write deployment log message guardrail, got %s", sql)
	}
}

func TestAuditIdentityControlCharacterRequirementHasForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/008_restrict_audit_identity_control_characters.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	if !strings.Contains(sql, "audit_events_identity_no_control_characters") {
		t.Fatalf("expected named audit identity constraint, got %s", sql)
	}
	if !strings.Contains(sql, "CHECK (actor !~ '[[:cntrl:]]' AND action !~ '[[:cntrl:]]' AND target_type !~ '[[:cntrl:]]' AND target_id !~ '[[:cntrl:]]' AND target_name !~ '[[:cntrl:]]') NOT VALID") {
		t.Fatalf("expected future-write audit identity guardrail, got %s", sql)
	}
}

func TestInstanceSettingsBrandingRequirementsHaveForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/010_restrict_instance_settings_branding.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	for _, expected := range []string{
		"instance_settings_brand_identity_required",
		"instance_settings_primary_color_hex",
		"instance_settings_branding_no_control_characters",
		"CHECK (btrim(name) <> '' AND btrim(short_name) <> '') NOT VALID",
		"CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$') NOT VALID",
		"CHECK (name !~ '[[:cntrl:]]' AND short_name !~ '[[:cntrl:]]' AND meta_description !~ '[[:cntrl:]]' AND logo_url !~ '[[:cntrl:]]' AND favicon_url !~ '[[:cntrl:]]' AND primary_color !~ '[[:cntrl:]]' AND docs_url !~ '[[:cntrl:]]') NOT VALID",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("expected instance settings guardrail %q, got %s", expected, sql)
		}
	}
}

func TestInstanceSettingsBrandAssetRequirementsHaveForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/016_restrict_branding_asset_urls.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	for _, expected := range []string{
		"instance_settings_logo_url_image_asset",
		"instance_settings_favicon_url_image_asset",
		"CHECK (logo_url = '' OR logo_url ~* '[.](svg|png|jpg|jpeg|webp|gif)([?#].*)?$') NOT VALID",
		"CHECK (favicon_url = '' OR favicon_url ~* '[.](ico|png|svg)([?#].*)?$') NOT VALID",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("expected instance settings asset guardrail %q, got %s", expected, sql)
		}
	}
}

func TestInstanceSettingsDataURLBrandAssetRequirementsHaveForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/021_allow_data_url_branding_assets.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	for _, expected := range []string{
		"DROP CONSTRAINT IF EXISTS instance_settings_logo_url_check",
		"DROP CONSTRAINT IF EXISTS instance_settings_favicon_url_check",
		"CHECK (logo_url = '' OR logo_url ~ '^data:image/' OR logo_url ~* '[.](svg|png|jpg|jpeg|webp|gif)([?#].*)?$') NOT VALID",
		"CHECK (favicon_url = '' OR favicon_url ~ '^data:image/' OR favicon_url ~* '[.](ico|png|svg)([?#].*)?$') NOT VALID",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("expected data URL branding asset migration %q, got %s", expected, sql)
		}
	}
}

func TestLegacyInstanceSettingsBrandAssetConstraintsAreDropped(t *testing.T) {
	migration, err := files.ReadFile("sql/022_drop_legacy_branding_asset_constraints.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	for _, expected := range []string{
		"DROP CONSTRAINT IF EXISTS instance_settings_logo_url_check",
		"DROP CONSTRAINT IF EXISTS instance_settings_favicon_url_check",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("expected legacy branding asset constraint cleanup %q, got %s", expected, sql)
		}
	}
}

func TestConnectorSyncStateRequirementsHaveForwardMigration(t *testing.T) {
	migration, err := files.ReadFile("sql/019_restrict_connector_sync_state.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(migration)
	for _, expected := range []string{
		"connector_accounts_name_no_control_characters",
		"connector_accounts_sync_status_known",
		"connector_accounts_sync_message_clean",
		"CHECK (name !~ '[[:cntrl:]]') NOT VALID",
		"CHECK (last_sync_status IS NULL OR last_sync_status IN ('ok', 'failed')) NOT VALID",
		"CHECK (last_sync_message IS NULL OR (btrim(last_sync_message) <> '' AND length(last_sync_message) <= 512 AND last_sync_message !~ '[[:cntrl:]]')) NOT VALID",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("expected connector sync state guardrail %q, got %s", expected, sql)
		}
	}
}

func rootMigrationNames() ([]string, error) {
	entries, err := os.ReadDir(filepath.Join("..", "..", "db", "migrations"))
	if err != nil {
		return nil, err
	}

	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		names = append(names, entry.Name())
	}
	sort.Strings(names)
	return names, nil
}

func equalStrings(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
