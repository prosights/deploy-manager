ALTER TABLE servers
    ADD CONSTRAINT servers_identity_no_control_characters
    CHECK (name !~ '[[:cntrl:]]' AND hostname !~ '[[:cntrl:]]' AND ssh_user !~ '[[:cntrl:]]' AND ssh_key_path !~ '[[:cntrl:]]') NOT VALID;
