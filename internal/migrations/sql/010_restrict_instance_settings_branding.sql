ALTER TABLE instance_settings
    ADD CONSTRAINT instance_settings_brand_identity_required
    CHECK (btrim(name) <> '' AND btrim(short_name) <> '') NOT VALID;

ALTER TABLE instance_settings
    ADD CONSTRAINT instance_settings_primary_color_hex
    CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$') NOT VALID;

ALTER TABLE instance_settings
    ADD CONSTRAINT instance_settings_branding_no_control_characters
    CHECK (name !~ '[[:cntrl:]]' AND short_name !~ '[[:cntrl:]]' AND meta_description !~ '[[:cntrl:]]' AND logo_url !~ '[[:cntrl:]]' AND favicon_url !~ '[[:cntrl:]]' AND primary_color !~ '[[:cntrl:]]' AND docs_url !~ '[[:cntrl:]]') NOT VALID;
