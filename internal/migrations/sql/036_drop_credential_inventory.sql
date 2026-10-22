DROP TABLE IF EXISTS credential_usages;
DROP TABLE IF EXISTS credential_permissions;
DROP TABLE IF EXISTS credentials;

ALTER TABLE connector_accounts
    DROP COLUMN IF EXISTS last_sync_status,
    DROP COLUMN IF EXISTS last_sync_message,
    DROP COLUMN IF EXISTS last_synced_at;
