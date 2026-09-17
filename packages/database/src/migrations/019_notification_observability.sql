-- Durable, tenant-scoped lifecycle notification delivery. Supabase auth mail is
-- deliberately outside this table; lifecycle mail is delivered by the worker.
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email')),
  recipient TEXT NOT NULL,
  template TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','leased','delivered','dead_letter')),
  provider_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  next_attempt_at TIMESTAMPTZ NOT NULL,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  delivered_at TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS notification_deliveries_due_idx
  ON notification_deliveries(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS notification_deliveries_tenant_idx
  ON notification_deliveries(client_id, created_at DESC);

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.notification_deliveries FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.notification_deliveries FROM authenticated;
  END IF;
END
$$;
