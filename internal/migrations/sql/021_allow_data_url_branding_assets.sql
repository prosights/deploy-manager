ALTER TABLE instance_settings
    DROP CONSTRAINT IF EXISTS instance_settings_logo_url_image_asset;

ALTER TABLE instance_settings
    DROP CONSTRAINT IF EXISTS instance_settings_logo_url_check;

ALTER TABLE instance_settings
    ADD CONSTRAINT instance_settings_logo_url_image_asset
    CHECK (logo_url = '' OR logo_url ~ '^data:image/' OR logo_url ~* '[.](svg|png|jpg|jpeg|webp|gif)([?#].*)?$') NOT VALID;

ALTER TABLE instance_settings
    DROP CONSTRAINT IF EXISTS instance_settings_favicon_url_image_asset;

ALTER TABLE instance_settings
    DROP CONSTRAINT IF EXISTS instance_settings_favicon_url_check;

ALTER TABLE instance_settings
    ADD CONSTRAINT instance_settings_favicon_url_image_asset
    CHECK (favicon_url = '' OR favicon_url ~ '^data:image/' OR favicon_url ~* '[.](ico|png|svg)([?#].*)?$') NOT VALID;
