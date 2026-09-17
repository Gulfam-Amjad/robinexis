CREATE TABLE IF NOT EXISTS twilio_connections (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('robinexis_account', 'customer_oauth')),
  account_sid TEXT,
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  api_key_sid TEXT,
  encrypted_api_key_secret TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'credentials_required', 'active', 'expired', 'revoked', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id)
);

CREATE INDEX IF NOT EXISTS twilio_connections_client_idx
  ON twilio_connections(client_id);

ALTER TABLE twilio_connections ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.twilio_connections FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.twilio_connections FROM authenticated;
  END IF;
END
$$;
