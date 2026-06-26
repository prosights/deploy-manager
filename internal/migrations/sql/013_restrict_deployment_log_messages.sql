ALTER TABLE deployment_logs
    ADD CONSTRAINT deployment_logs_message_length
    CHECK (length(message) <= 32768) NOT VALID;
