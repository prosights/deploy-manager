ALTER TABLE deployments
    ALTER COLUMN strategy SET DEFAULT 'blue_green';

DO $$
DECLARE
    constraint_record record;
BEGIN
    FOR constraint_record IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'deployments'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%strategy%'
    LOOP
        EXECUTE format('ALTER TABLE deployments DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
    END LOOP;
END $$;

ALTER TABLE deployments
    ADD CONSTRAINT deployments_strategy_blue_green_only
    CHECK (strategy = 'blue_green') NOT VALID;
