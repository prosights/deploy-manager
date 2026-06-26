ALTER TABLE proxy_routes
    ADD CONSTRAINT proxy_routes_upstream_url_origin_only
    CHECK (upstream_url ~ '^https?://[^/?#]+/?$') NOT VALID;
