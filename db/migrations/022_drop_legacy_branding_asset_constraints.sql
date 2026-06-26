ALTER TABLE instance_settings
    DROP CONSTRAINT IF EXISTS instance_settings_logo_url_check;

ALTER TABLE instance_settings
    DROP CONSTRAINT IF EXISTS instance_settings_favicon_url_check;
