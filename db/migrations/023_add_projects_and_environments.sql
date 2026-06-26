CREATE TABLE IF NOT EXISTS projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(name) <> ''),
    CHECK (btrim(slug) <> ''),
    CHECK (slug = lower(slug)),
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' OR slug ~ '^[a-z0-9]$'),
    CHECK (name !~ '[[:cntrl:]]' AND slug !~ '[[:cntrl:]]' AND description !~ '[[:cntrl:]]')
);

INSERT INTO projects (name, slug, description)
VALUES ('Production', 'production', 'Default deployment project')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS environments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name text NOT NULL,
    slug text NOT NULL,
    kind text NOT NULL DEFAULT 'development' CHECK (kind IN ('production', 'development', 'preview')),
    is_ephemeral boolean NOT NULL DEFAULT false,
    pull_request_number integer,
    branch text,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(name) <> ''),
    CHECK (btrim(slug) <> ''),
    CHECK (slug = lower(slug)),
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' OR slug ~ '^[a-z0-9]$'),
    CHECK (name !~ '[[:cntrl:]]' AND slug !~ '[[:cntrl:]]' AND COALESCE(branch, '') !~ '[[:cntrl:]]'),
    CHECK ((kind = 'preview' AND is_ephemeral = true) OR (kind <> 'preview' AND is_ephemeral = false)),
    CHECK (pull_request_number IS NULL OR pull_request_number > 0),
    UNIQUE(project_id, slug)
);

WITH production_project AS (
    SELECT id FROM projects WHERE slug = 'production'
)
INSERT INTO environments (project_id, name, slug, kind, is_ephemeral)
SELECT id, 'Production', 'production', 'production', false FROM production_project
UNION ALL
SELECT id, 'Development', 'development', 'development', false FROM production_project
ON CONFLICT (project_id, slug) DO NOTHING;

ALTER TABLE applications
ADD COLUMN IF NOT EXISTS environment_id uuid REFERENCES environments(id) ON DELETE RESTRICT;

UPDATE applications
SET environment_id = (
    SELECT environments.id
    FROM environments
    JOIN projects ON projects.id = environments.project_id
    WHERE projects.slug = 'production' AND environments.slug = 'production'
)
WHERE environment_id IS NULL;

ALTER TABLE applications
ALTER COLUMN environment_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS applications_environment_id_idx ON applications(environment_id);
CREATE INDEX IF NOT EXISTS environments_project_id_idx ON environments(project_id);
