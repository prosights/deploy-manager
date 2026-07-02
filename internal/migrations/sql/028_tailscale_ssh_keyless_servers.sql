DO $$
DECLARE
    constraint_record record;
BEGIN
    FOR constraint_record IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'servers'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%ssh_key_path%'
    LOOP
        EXECUTE format('ALTER TABLE servers DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
    END LOOP;
END $$;

ALTER TABLE servers
    ADD CONSTRAINT servers_ssh_key_path_required_for_direct_ssh
    CHECK (connection_mode <> 'direct_ssh' OR (ssh_key_path IS NOT NULL AND btrim(ssh_key_path) <> '')) NOT VALID;

ALTER TABLE servers
    ADD CONSTRAINT servers_ssh_key_path_empty_for_tailscale_ssh
    CHECK (connection_mode <> 'tailscale_ssh' OR ssh_key_path IS NULL) NOT VALID;

ALTER TABLE servers
    ADD CONSTRAINT servers_ssh_key_path_location
    CHECK (ssh_key_path IS NULL OR left(btrim(ssh_key_path), 1) = '/' OR left(btrim(ssh_key_path), 2) = '~/') NOT VALID;

ALTER TABLE servers
    ADD CONSTRAINT servers_ssh_key_path_no_empty_segments
    CHECK (ssh_key_path IS NULL OR btrim(ssh_key_path) !~ '//') NOT VALID;

ALTER TABLE servers
    ADD CONSTRAINT servers_ssh_key_path_no_parent_segments
    CHECK (ssh_key_path IS NULL OR btrim(ssh_key_path) !~ '(^|/)\.\.(/|$)') NOT VALID;

ALTER TABLE servers
    ADD CONSTRAINT servers_identity_no_control_characters
    CHECK (name !~ '[[:cntrl:]]' AND hostname !~ '[[:cntrl:]]' AND ssh_user !~ '[[:cntrl:]]' AND COALESCE(ssh_key_path, '') !~ '[[:cntrl:]]' AND connection_mode !~ '[[:cntrl:]]') NOT VALID;
