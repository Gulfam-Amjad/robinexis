-- Normalized SaaS control-plane tables. The API service remains the only data plane:
-- RLS is enabled without browser-role policies and anon/authenticated grants are revoked.

CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  auth_user_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL CHECK (email = lower(email)),
  display_name TEXT,
  platform_role TEXT NOT NULL CHECK (platform_role IN ('admin', 'client')),
  workspace_role TEXT CHECK (workspace_role IN ('owner', 'manager', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (email),
  CHECK (
    (platform_role = 'admin' AND client_id IS NULL AND workspace_role IS NULL)
    OR
    (platform_role = 'client' AND client_id IS NOT NULL AND workspace_role IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS user_profiles_client_idx ON user_profiles(client_id);
CREATE INDEX IF NOT EXISTS user_profiles_auth_user_idx ON user_profiles(auth_user_id);

CREATE TABLE IF NOT EXISTS client_config_revisions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'superseded')),
  config JSONB NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  UNIQUE (client_id, id)
);
CREATE INDEX IF NOT EXISTS client_config_revisions_client_idx
  ON client_config_revisions(client_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS client_config_revisions_one_draft_idx
  ON client_config_revisions(client_id) WHERE status = 'draft';

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/London',
  phone TEXT,
  address JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (client_id, slug)
);
CREATE INDEX IF NOT EXISTS locations_client_idx ON locations(client_id);
CREATE UNIQUE INDEX IF NOT EXISTS locations_one_primary_per_client_idx
  ON locations(client_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS agent_instances (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  location_id TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('elevenlabs')),
  provider_agent_id TEXT,
  voice_credential_hash TEXT,
  provider_secret_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'disabled', 'failed')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (provider, provider_agent_id),
  UNIQUE (voice_credential_hash),
  FOREIGN KEY (client_id, location_id) REFERENCES locations(client_id, id)
);
CREATE INDEX IF NOT EXISTS agent_instances_client_idx ON agent_instances(client_id);
CREATE INDEX IF NOT EXISTS agent_instances_client_location_idx ON agent_instances(client_id, location_id);

CREATE TABLE IF NOT EXISTS phone_endpoints (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  location_id TEXT,
  agent_instance_id TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('twilio', 'elevenlabs')),
  e164 TEXT NOT NULL CHECK (e164 ~ '^\+[1-9][0-9]{7,14}$'),
  provider_endpoint_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'both')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'disabled', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (e164),
  UNIQUE (provider, provider_endpoint_id),
  FOREIGN KEY (client_id, location_id) REFERENCES locations(client_id, id),
  FOREIGN KEY (client_id, agent_instance_id) REFERENCES agent_instances(client_id, id)
);
CREATE INDEX IF NOT EXISTS phone_endpoints_client_idx ON phone_endpoints(client_id);
CREATE INDEX IF NOT EXISTS phone_endpoints_client_location_idx ON phone_endpoints(client_id, location_id);
CREATE INDEX IF NOT EXISTS phone_endpoints_client_agent_idx ON phone_endpoints(client_id, agent_instance_id);

CREATE TABLE IF NOT EXISTS calendar_connections (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  location_id TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('calcom', 'google', 'outlook', 'fresha')),
  external_account_id TEXT,
  credential_ref TEXT NOT NULL CHECK (credential_ref ~ '^[A-Z][A-Z0-9_]*$'),
  calendar_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'disabled', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (client_id, provider, external_account_id),
  FOREIGN KEY (client_id, location_id) REFERENCES locations(client_id, id)
);
CREATE INDEX IF NOT EXISTS calendar_connections_client_idx ON calendar_connections(client_id);
CREATE INDEX IF NOT EXISTS calendar_connections_client_location_idx ON calendar_connections(client_id, location_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'internal' CHECK (provider IN ('internal', 'stripe')),
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  plan_tier TEXT NOT NULL CHECK (plan_tier IN ('starter', 'pro', 'enterprise')),
  status TEXT NOT NULL CHECK (status IN (
    'trialing', 'active', 'past_due', 'canceled', 'unpaid',
    'incomplete', 'incomplete_expired', 'paused'
  )),
  price_id TEXT,
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (provider, provider_subscription_id),
  CHECK (provider = 'internal' OR provider_customer_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS subscriptions_client_idx ON subscriptions(client_id);
CREATE INDEX IF NOT EXISTS subscriptions_client_updated_idx ON subscriptions(client_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS subscriptions_provider_customer_idx ON subscriptions(provider, provider_customer_id);

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  livemode BOOLEAN NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'processed', 'failed')),
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (client_id, id)
);
CREATE INDEX IF NOT EXISTS stripe_events_client_idx ON stripe_events(client_id);
CREATE INDEX IF NOT EXISTS stripe_events_client_received_idx ON stripe_events(client_id, received_at DESC);
CREATE INDEX IF NOT EXISTS stripe_events_status_idx ON stripe_events(status, received_at);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_sessions_client_id_id_unique') THEN
    ALTER TABLE call_sessions
      ADD CONSTRAINT call_sessions_client_id_id_unique UNIQUE (client_id, id);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS booking_records (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  location_id TEXT,
  calendar_connection_id TEXT,
  call_id TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('calcom', 'google', 'outlook', 'fresha')),
  provider_booking_id TEXT,
  idempotency_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled', 'failed')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  attendee_name TEXT,
  attendee_phone TEXT,
  attendee_email TEXT,
  service_slug TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (client_id, idempotency_key),
  UNIQUE (client_id, provider, provider_booking_id),
  CHECK (ends_at > starts_at),
  FOREIGN KEY (client_id, location_id) REFERENCES locations(client_id, id),
  FOREIGN KEY (client_id, calendar_connection_id) REFERENCES calendar_connections(client_id, id),
  FOREIGN KEY (client_id, call_id) REFERENCES call_sessions(client_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS booking_records_client_idx ON booking_records(client_id);
CREATE INDEX IF NOT EXISTS booking_records_client_starts_idx ON booking_records(client_id, starts_at DESC);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  minutes NUMERIC(12,4) NOT NULL CHECK (minutes <> 0),
  kind TEXT NOT NULL CHECK (kind IN ('grant', 'purchase', 'usage', 'adjustment', 'refund', 'expiry')),
  direction TEXT CHECK (direction IN ('inbound', 'outbound')),
  reference_type TEXT,
  reference_id TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id)
);
CREATE INDEX IF NOT EXISTS credit_ledger_client_idx ON credit_ledger(client_id);
CREATE INDEX IF NOT EXISTS credit_ledger_client_created_idx ON credit_ledger(client_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_reference_idx
  ON credit_ledger(client_id, reference_type, reference_id)
  WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS provisioning_runs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  step TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB,
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (client_id, idempotency_key),
  CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);
CREATE INDEX IF NOT EXISTS provisioning_runs_client_idx ON provisioning_runs(client_id);
CREATE INDEX IF NOT EXISTS provisioning_runs_client_created_idx ON provisioning_runs(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS provisioning_runs_status_idx ON provisioning_runs(status, updated_at);

-- Backfill existing clients into the normalized control plane without changing
-- their live JSON config or external routing.
INSERT INTO locations (id, client_id, slug, name, timezone, phone, is_primary)
SELECT
  'loc_' || c.id || '_primary',
  c.id,
  'primary',
  COALESCE(NULLIF(c.config->>'businessName', ''), c.slug),
  COALESCE(NULLIF(c.config#>>'{callingWindow,tz}', ''), 'Europe/London'),
  NULLIF(c.config->>'phone', ''),
  true
FROM clients c
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_instances (
  id, client_id, location_id, provider, provider_agent_id, name, status, config
)
SELECT
  'agent_' || c.id || '_primary',
  c.id,
  'loc_' || c.id || '_primary',
  'elevenlabs',
  c.config->>'elevenlabsAgentId',
  COALESCE(NULLIF(c.config->>'businessName', ''), c.slug) || ' receptionist',
  CASE WHEN COALESCE((c.config->>'published')::boolean, false) THEN 'active' ELSE 'pending' END,
  jsonb_build_object('legacyConfig', true)
FROM clients c
WHERE NULLIF(c.config->>'elevenlabsAgentId', '') IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO phone_endpoints (
  id, client_id, location_id, agent_instance_id, provider, e164, direction, status
)
SELECT
  'phone_' || md5(numbers.e164),
  c.id,
  'loc_' || c.id || '_primary',
  CASE
    WHEN NULLIF(c.config->>'elevenlabsAgentId', '') IS NOT NULL
      THEN 'agent_' || c.id || '_primary'
    ELSE NULL
  END,
  'twilio',
  numbers.e164,
  'inbound',
  'active'
FROM clients c
CROSS JOIN LATERAL jsonb_array_elements_text(
  COALESCE(c.config->'inboundNumbers', '[]'::jsonb)
) AS numbers(e164)
WHERE numbers.e164 ~ '^\+[1-9][0-9]{7,14}$'
ON CONFLICT (e164) DO NOTHING;

INSERT INTO calendar_connections (
  id, client_id, location_id, provider, external_account_id, credential_ref, status, metadata
)
SELECT
  'calendar_' || c.id || '_primary',
  c.id,
  'loc_' || c.id || '_primary',
  c.config#>>'{calendar,provider}',
  NULLIF(c.config#>>'{calendar,username}', ''),
  c.config#>>'{calendar,credentialRef}',
  'active',
  jsonb_build_object('legacyConfig', true)
FROM clients c
WHERE c.config#>>'{calendar,provider}' IN ('calcom', 'google', 'outlook', 'fresha')
  AND c.config#>>'{calendar,credentialRef}' ~ '^[A-Z][A-Z0-9_]*$'
ON CONFLICT (id) DO NOTHING;

INSERT INTO subscriptions (
  id, client_id, provider, plan_tier, status, trial_ends_at, metadata
)
SELECT
  'subscription_' || c.id || '_legacy',
  c.id,
  'internal',
  CASE
    WHEN lower(COALESCE(c.config->>'subscribedProduct', '')) IN ('starter', 'pro', 'enterprise')
      THEN lower(c.config->>'subscribedProduct')
    ELSE 'starter'
  END,
  CASE
    WHEN c.config->>'serviceStatus' IN (
      'trialing', 'active', 'past_due', 'canceled', 'unpaid',
      'incomplete', 'incomplete_expired', 'paused'
    ) THEN c.config->>'serviceStatus'
    ELSE 'trialing'
  END,
  NULL,
  jsonb_build_object('legacyConfig', true, 'requiresPlanReview', true)
FROM clients c
ON CONFLICT (id) DO NOTHING;

-- Legacy JSONB rows already carry clientId. Materialize it without inventing a tenant.
ALTER TABLE outbound_jobs ADD COLUMN IF NOT EXISTS client_id TEXT;
UPDATE outbound_jobs j
SET client_id = j.payload->>'clientId'
WHERE j.client_id IS NULL
  AND j.payload ? 'clientId'
  AND EXISTS (SELECT 1 FROM clients c WHERE c.id = j.payload->>'clientId');

ALTER TABLE call_notes ADD COLUMN IF NOT EXISTS client_id TEXT;
UPDATE call_notes n
SET client_id = n.payload->>'clientId'
WHERE n.client_id IS NULL
  AND n.payload ? 'clientId'
  AND EXISTS (SELECT 1 FROM clients c WHERE c.id = n.payload->>'clientId');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbound_jobs_client_fk') THEN
    ALTER TABLE outbound_jobs
      ADD CONSTRAINT outbound_jobs_client_fk FOREIGN KEY (client_id)
      REFERENCES clients(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_notes_client_fk') THEN
    ALTER TABLE call_notes
      ADD CONSTRAINT call_notes_client_fk FOREIGN KEY (client_id)
      REFERENCES clients(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbound_jobs_payload_client_check') THEN
    ALTER TABLE outbound_jobs
      ADD CONSTRAINT outbound_jobs_payload_client_check
      CHECK (client_id IS NULL OR payload->>'clientId' = client_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_notes_payload_client_check') THEN
    ALTER TABLE call_notes
      ADD CONSTRAINT call_notes_payload_client_check
      CHECK (client_id IS NULL OR payload->>'clientId' = client_id) NOT VALID;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS outbound_jobs_client_idx ON outbound_jobs(client_id);
CREATE INDEX IF NOT EXISTS call_notes_client_idx ON call_notes(client_id);

DO $$
DECLARE
  table_name TEXT;
  protected_tables TEXT[] := ARRAY[
    'user_profiles', 'client_config_revisions', 'locations', 'agent_instances', 'phone_endpoints',
    'calendar_connections', 'subscriptions', 'stripe_events', 'booking_records',
    'credit_ledger', 'provisioning_runs'
  ];
BEGIN
  FOREACH table_name IN ARRAY protected_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', table_name);
    END IF;
  END LOOP;
END
$$;
