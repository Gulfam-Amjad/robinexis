ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS tenant_requests (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('team_invite', 'data_export', 'workspace_deletion', 'support')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'rejected', 'revoked')),
  requested_by TEXT NOT NULL,
  email TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id)
);

CREATE INDEX IF NOT EXISTS tenant_requests_client_status_idx
  ON tenant_requests(client_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_requests_pending_invite_uidx
  ON tenant_requests(client_id, lower(email))
  WHERE type = 'team_invite' AND status IN ('pending', 'in_progress');

ALTER TABLE tenant_requests ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.tenant_requests FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.tenant_requests FROM authenticated;
  END IF;
END
$$;
