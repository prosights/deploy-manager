ALTER TABLE credentials
    ADD CONSTRAINT credentials_identity_no_control_characters
    CHECK (name !~ '[[:cntrl:]]' AND external_ref !~ '[[:cntrl:]]' AND credential_type !~ '[[:cntrl:]]') NOT VALID;

ALTER TABLE credential_permissions
    ADD CONSTRAINT credential_permissions_no_control_characters
    CHECK (resource_type !~ '[[:cntrl:]]' AND resource_name !~ '[[:cntrl:]]' AND permission !~ '[[:cntrl:]]' AND source !~ '[[:cntrl:]]') NOT VALID;

ALTER TABLE credential_usages
    ADD CONSTRAINT credential_usages_no_control_characters
    CHECK (used_by_type !~ '[[:cntrl:]]' AND used_by_name !~ '[[:cntrl:]]' AND usage_context !~ '[[:cntrl:]]') NOT VALID;
