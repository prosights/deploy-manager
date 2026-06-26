ALTER TABLE servers
    ADD CONSTRAINT servers_ssh_key_path_required
    CHECK (ssh_key_path IS NOT NULL AND btrim(ssh_key_path) <> '') NOT VALID;
