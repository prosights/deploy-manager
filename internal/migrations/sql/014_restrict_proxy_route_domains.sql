ALTER TABLE proxy_routes
    ADD CONSTRAINT proxy_routes_domain_lowercase
    CHECK (domain = lower(domain)) NOT VALID;

ALTER TABLE proxy_routes
    ADD CONSTRAINT proxy_routes_domain_length
    CHECK (length(domain) <= 253) NOT VALID;

ALTER TABLE proxy_routes
    ADD CONSTRAINT proxy_routes_domain_allowed_characters
    CHECK (domain ~ '^[a-z0-9.-]+$') NOT VALID;

ALTER TABLE proxy_routes
    ADD CONSTRAINT proxy_routes_domain_label_boundaries
    CHECK (domain !~ '(^|[.])-|-(\.|$)|[.]{2}') NOT VALID;
