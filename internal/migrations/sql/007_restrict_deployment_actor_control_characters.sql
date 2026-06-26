ALTER TABLE deployments
    ADD CONSTRAINT deployments_actor_no_control_characters
    CHECK (actor IS NULL OR actor !~ '[[:cntrl:]]') NOT VALID;
