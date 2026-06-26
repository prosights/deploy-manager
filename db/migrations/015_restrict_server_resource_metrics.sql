ALTER TABLE servers
    ADD CONSTRAINT servers_cpu_usage_percentage
    CHECK (cpu_usage IS NULL OR (cpu_usage >= 0 AND cpu_usage <= 100)) NOT VALID;

ALTER TABLE servers
    ADD CONSTRAINT servers_memory_usage_percentage
    CHECK (memory_usage IS NULL OR (memory_usage >= 0 AND memory_usage <= 100)) NOT VALID;

ALTER TABLE servers
    ADD CONSTRAINT servers_disk_usage_percentage
    CHECK (disk_usage IS NULL OR (disk_usage >= 0 AND disk_usage <= 100)) NOT VALID;
