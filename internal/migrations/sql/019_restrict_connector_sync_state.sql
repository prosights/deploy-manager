ALTER TABLE connector_accounts
    ADD CONSTRAINT connector_accounts_name_no_control_characters
    CHECK (name !~ '[[:cntrl:]]') NOT VALID;

ALTER TABLE connector_accounts
    ADD CONSTRAINT connector_accounts_sync_status_known
    CHECK (last_sync_status IS NULL OR last_sync_status IN ('ok', 'failed')) NOT VALID;

ALTER TABLE connector_accounts
    ADD CONSTRAINT connector_accounts_sync_message_clean
    CHECK (last_sync_message IS NULL OR (btrim(last_sync_message) <> '' AND length(last_sync_message) <= 512 AND last_sync_message !~ '[[:cntrl:]]')) NOT VALID;
