ALTER TABLE proxy_routes
    ADD CONSTRAINT proxy_routes_upstream_url_no_control_characters
    CHECK (upstream_url !~ '[[:cntrl:]]') NOT VALID;
