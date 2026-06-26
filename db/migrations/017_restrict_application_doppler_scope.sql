ALTER TABLE applications
    ADD CONSTRAINT applications_doppler_project_clean
    CHECK (doppler_project IS NULL OR (btrim(doppler_project) <> '' AND doppler_project !~ '[[:cntrl:]]')) NOT VALID;

ALTER TABLE applications
    ADD CONSTRAINT applications_doppler_config_clean
    CHECK (doppler_config IS NULL OR (btrim(doppler_config) <> '' AND doppler_config !~ '[[:cntrl:]]')) NOT VALID;
