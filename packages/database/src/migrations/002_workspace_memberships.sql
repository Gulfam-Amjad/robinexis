CREATE TABLE IF NOT EXISTS workspace_memberships (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, email),
  CHECK (email = lower(email))
);

CREATE INDEX IF NOT EXISTS workspace_memberships_email_idx
  ON workspace_memberships(email);

CREATE INDEX IF NOT EXISTS workspace_memberships_client_idx
  ON workspace_memberships(client_id);

UPDATE clients
SET config = jsonb_set(
  config,
  '{elevenlabsAgentId}',
  '"agent_6101m1c3n4wnfsgskgzr13w2gt9s"'::jsonb,
  true
)
WHERE id = 'client_blades_hair'
  AND NOT (config ? 'elevenlabsAgentId');

CREATE UNIQUE INDEX IF NOT EXISTS clients_elevenlabs_agent_idx
  ON clients ((config->>'elevenlabsAgentId'))
  WHERE config->>'elevenlabsAgentId' IS NOT NULL;
