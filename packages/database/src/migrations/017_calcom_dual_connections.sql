-- Tenant-scoped Cal.com OAuth/Platform credentials. Tokens are AES-GCM
-- ciphertext produced by the API and are never readable by browser roles.
ALTER TABLE calendar_connections ALTER COLUMN credential_ref DROP NOT NULL;
ALTER TABLE calendar_connections
  ADD COLUMN IF NOT EXISTS connection_mode TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_access_token TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS destination_provider TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calendar_connections_mode_check'
  ) THEN
    ALTER TABLE calendar_connections
      ADD CONSTRAINT calendar_connections_mode_check
      CHECK (connection_mode IS NULL OR connection_mode IN ('oauth', 'managed', 'legacy'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS calendar_connections_active_calcom_idx
  ON calendar_connections(client_id)
  WHERE provider = 'calcom' AND status = 'active';

ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.calendar_connections FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.calendar_connections FROM authenticated;
  END IF;
END
$$;
