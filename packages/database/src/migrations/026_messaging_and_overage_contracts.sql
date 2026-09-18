-- Additive data contracts for managed messaging and optional minute overage.
-- Message units are intentionally isolated from the voice credit_ledger.

CREATE TABLE IF NOT EXISTS tenant_feature_entitlements (
  client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_minute_blocks_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_usage_periods (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'whatsapp')),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  included_messages INTEGER NOT NULL DEFAULT 0 CHECK (included_messages >= 0),
  used_messages INTEGER NOT NULL DEFAULT 0 CHECK (used_messages >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, channel, period_start),
  CHECK (period_end > period_start)
);
CREATE INDEX IF NOT EXISTS message_usage_periods_client_idx
  ON message_usage_periods(client_id, period_start DESC);

CREATE TABLE IF NOT EXISTS message_sessions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'whatsapp')),
  contact_address TEXT NOT NULL,
  sender_address TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'closed', 'opted_out')),
  service_window_expires_at TIMESTAMPTZ,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (client_id, channel, contact_address, sender_address)
);

CREATE TABLE IF NOT EXISTS message_events (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'whatsapp')),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  provider TEXT NOT NULL,
  provider_message_id TEXT,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received', 'processing', 'processed', 'queued', 'sent', 'delivered', 'failed', 'suppressed')),
  body TEXT,
  billable_units INTEGER NOT NULL DEFAULT 0 CHECK (billable_units >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  processing_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (processing_attempt_count >= 0),
  processing_lease_owner TEXT,
  processing_lease_expires_at TIMESTAMPTZ,
  processing_error TEXT,
  processed_at TIMESTAMPTZ,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, idempotency_key),
  UNIQUE (provider, provider_message_id),
  UNIQUE (client_id, session_id, id),
  FOREIGN KEY (client_id, session_id) REFERENCES message_sessions(client_id, id)
);
CREATE INDEX IF NOT EXISTS message_events_session_idx
  ON message_events(client_id, session_id, occurred_at);
ALTER TABLE message_events ADD COLUMN IF NOT EXISTS processing_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE message_events ADD COLUMN IF NOT EXISTS processing_lease_owner TEXT;
ALTER TABLE message_events ADD COLUMN IF NOT EXISTS processing_lease_expires_at TIMESTAMPTZ;
ALTER TABLE message_events ADD COLUMN IF NOT EXISTS processing_error TEXT;
ALTER TABLE message_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE message_events DROP CONSTRAINT IF EXISTS message_events_status_check;
ALTER TABLE message_events ADD CONSTRAINT message_events_status_check
  CHECK (status IN ('received', 'processing', 'processed', 'queued', 'sent', 'delivered', 'failed', 'suppressed'));
CREATE INDEX IF NOT EXISTS message_events_inbound_due_idx
  ON message_events(status, processing_lease_expires_at, occurred_at)
  WHERE direction = 'inbound' AND channel = 'whatsapp';

CREATE TABLE IF NOT EXISTS scheduled_followups (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  session_id TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'whatsapp')),
  recipient TEXT NOT NULL,
  template TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'completed', 'cancelled', 'dead_letter')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, idempotency_key),
  FOREIGN KEY (client_id, session_id) REFERENCES message_sessions(client_id, id)
);
CREATE INDEX IF NOT EXISTS scheduled_followups_due_idx
  ON scheduled_followups(status, scheduled_at);

CREATE TABLE IF NOT EXISTS overage_purchase_records (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  boundary_minutes INTEGER NOT NULL CHECK (boundary_minutes >= 0),
  granted_minutes INTEGER NOT NULL DEFAULT 100 CHECK (granted_minutes > 0),
  amount_minor INTEGER NOT NULL DEFAULT 1500 CHECK (amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'refunded')),
  stripe_payment_id TEXT,
  credit_ledger_entry_id TEXT,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (client_id, idempotency_key),
  UNIQUE (client_id, boundary_minutes)
);

ALTER TABLE notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_channel_check;
ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_channel_check
  CHECK (channel IN ('email', 'sms', 'whatsapp'));
ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE tenant_feature_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_usage_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE overage_purchase_records ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.tenant_feature_entitlements FROM anon;
    REVOKE ALL ON public.message_usage_periods FROM anon;
    REVOKE ALL ON public.message_sessions FROM anon;
    REVOKE ALL ON public.message_events FROM anon;
    REVOKE ALL ON public.scheduled_followups FROM anon;
    REVOKE ALL ON public.overage_purchase_records FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.tenant_feature_entitlements FROM authenticated;
    REVOKE ALL ON public.message_usage_periods FROM authenticated;
    REVOKE ALL ON public.message_sessions FROM authenticated;
    REVOKE ALL ON public.message_events FROM authenticated;
    REVOKE ALL ON public.scheduled_followups FROM authenticated;
    REVOKE ALL ON public.overage_purchase_records FROM authenticated;
  END IF;
END
$$;
