ALTER TABLE applications
    ADD CONSTRAINT applications_health_check_url_no_control_characters
    CHECK (health_check_url IS NULL OR health_check_url !~ '[[:cntrl:]]') NOT VALID;
