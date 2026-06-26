ALTER TABLE audit_events
    ADD CONSTRAINT audit_events_identity_no_control_characters
    CHECK (actor !~ '[[:cntrl:]]' AND action !~ '[[:cntrl:]]' AND target_type !~ '[[:cntrl:]]' AND target_id !~ '[[:cntrl:]]' AND target_name !~ '[[:cntrl:]]') NOT VALID;
