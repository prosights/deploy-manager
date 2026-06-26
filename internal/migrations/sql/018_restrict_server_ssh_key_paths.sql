ALTER TABLE servers
    ADD CONSTRAINT servers_ssh_key_path_location
    CHECK (left(btrim(ssh_key_path), 1) = '/' OR left(btrim(ssh_key_path), 2) = '~/') NOT VALID;

ALTER TABLE servers
    ADD CONSTRAINT servers_ssh_key_path_no_empty_segments
    CHECK (btrim(ssh_key_path) !~ '//') NOT VALID;

ALTER TABLE servers
    ADD CONSTRAINT servers_ssh_key_path_no_parent_segments
    CHECK (btrim(ssh_key_path) !~ '(^|/)\.\.(/|$)') NOT VALID;
