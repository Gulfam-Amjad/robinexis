-- REFERENCE SNAPSHOT ONLY. This file is not a fresh-install entry point.
-- The ordered files in src/migrations are the sole executable schema source.
-- Use `npm run db:migrate`; never apply this snapshot directly.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  version INT NOT NULL,
  compiled TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS prompt_versions_client_version_idx
  ON prompt_versions(client_id, version);

CREATE TABLE IF NOT EXISTS call_sessions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_sessions_client_idx ON call_sessions(client_id);

CREATE TABLE IF NOT EXISTS tool_actions (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  input JSONB,
  result JSONB,
  error TEXT,
  idempotency_key TEXT,
  at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tool_idem_unique_idx
  ON tool_actions(client_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS outbound_jobs (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS suppressions (
  client_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (client_id, phone)
);

CREATE TABLE IF NOT EXISTS call_notes (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_counters (
  client_id TEXT NOT NULL,
  month TEXT NOT NULL,
  inbound_minutes INT NOT NULL DEFAULT 0,
  outbound_minutes INT NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, month)
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('txt', 'markdown', 'pdf')),
  source_uri TEXT,
  mime_type TEXT,
  checksum TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'indexed', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id)
);

CREATE INDEX IF NOT EXISTS knowledge_documents_client_created_idx
  ON knowledge_documents(client_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS knowledge_documents_client_status_idx
  ON knowledge_documents(client_id, status);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  token_count INT NOT NULL,
  embedding vector(768) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, document_id, chunk_index),
  FOREIGN KEY (client_id, document_id)
    REFERENCES knowledge_documents(client_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS knowledge_chunks_client_document_idx
  ON knowledge_chunks(client_id, document_id, chunk_index);
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw_idx
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

-- SaaS control plane (migration 006).
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
  UNIQUE (client_id, id), UNIQUE (email),
  CHECK (
    (platform_role = 'admin' AND client_id IS NULL AND workspace_role IS NULL)
    OR (platform_role = 'client' AND client_id IS NOT NULL AND workspace_role IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS user_profiles_client_idx ON user_profiles(client_id);

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
CREATE INDEX IF NOT EXISTS client_config_revisions_client_idx ON client_config_revisions(client_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS client_config_revisions_one_draft_idx ON client_config_revisions(client_id) WHERE status = 'draft';

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
  UNIQUE (client_id, id), UNIQUE (client_id, slug)
);
CREATE INDEX IF NOT EXISTS locations_client_idx ON locations(client_id);
CREATE UNIQUE INDEX IF NOT EXISTS locations_one_primary_per_client_idx ON locations(client_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS agent_instances (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  location_id TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('elevenlabs', 'livekit')),
  provider_agent_id TEXT UNIQUE,
  voice_credential_hash TEXT UNIQUE,
  provider_secret_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'disabled', 'failed')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  FOREIGN KEY (client_id, location_id) REFERENCES locations(client_id, id)
);
CREATE INDEX IF NOT EXISTS agent_instances_client_idx ON agent_instances(client_id);

CREATE TABLE IF NOT EXISTS phone_endpoints (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  location_id TEXT,
  agent_instance_id TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('twilio', 'elevenlabs')),
  e164 TEXT NOT NULL UNIQUE CHECK (e164 ~ '^\+[1-9][0-9]{7,14}$'),
  provider_endpoint_id TEXT UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'both')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'disabled', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  FOREIGN KEY (client_id, location_id) REFERENCES locations(client_id, id),
  FOREIGN KEY (client_id, agent_instance_id) REFERENCES agent_instances(client_id, id)
);
CREATE INDEX IF NOT EXISTS phone_endpoints_client_idx ON phone_endpoints(client_id);

CREATE TABLE IF NOT EXISTS calendar_connections (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  location_id TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('calcom', 'google', 'outlook', 'fresha')),
  external_account_id TEXT,
  credential_ref TEXT CHECK (credential_ref ~ '^[A-Z][A-Z0-9_]*$'),
  connection_mode TEXT CHECK (connection_mode IS NULL OR connection_mode IN ('oauth', 'managed', 'legacy')),
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  calendar_id TEXT,
  destination_provider TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'disabled', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id), UNIQUE (client_id, provider, external_account_id),
  FOREIGN KEY (client_id, location_id) REFERENCES locations(client_id, id)
);
CREATE INDEX IF NOT EXISTS calendar_connections_client_idx ON calendar_connections(client_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'internal' CHECK (provider IN ('internal', 'stripe')),
  provider_customer_id TEXT,
  provider_subscription_id TEXT UNIQUE,
  plan_tier TEXT NOT NULL CHECK (plan_tier IN ('starter', 'pro', 'enterprise')),
  status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused')),
  price_id TEXT,
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  CHECK (provider = 'internal' OR provider_customer_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS subscriptions_client_idx ON subscriptions(client_id);

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

CREATE UNIQUE INDEX IF NOT EXISTS call_sessions_client_id_id_unique
  ON call_sessions(client_id, id);

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
  ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  attendee_name TEXT,
  attendee_phone TEXT,
  attendee_email TEXT,
  service_slug TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id), UNIQUE (client_id, idempotency_key),
  UNIQUE (client_id, provider, provider_booking_id),
  FOREIGN KEY (client_id, location_id) REFERENCES locations(client_id, id),
  FOREIGN KEY (client_id, calendar_connection_id) REFERENCES calendar_connections(client_id, id),
  FOREIGN KEY (client_id, call_id) REFERENCES call_sessions(client_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS booking_records_client_idx ON booking_records(client_id);

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
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_reference_idx
  ON credit_ledger(client_id, reference_type, reference_id)
  WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS provisioning_runs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'paused', 'succeeded', 'activation_pending', 'activating', 'failed', 'cancelled')),
  step TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB,
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  claim_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id), UNIQUE (client_id, idempotency_key),
  CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);
CREATE INDEX IF NOT EXISTS provisioning_runs_client_idx ON provisioning_runs(client_id);

ALTER TABLE outbound_jobs ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE call_notes ADD COLUMN IF NOT EXISTS client_id TEXT;
CREATE INDEX IF NOT EXISTS outbound_jobs_client_idx ON outbound_jobs(client_id);
CREATE INDEX IF NOT EXISTS call_notes_client_idx ON call_notes(client_id);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_config_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE provisioning_runs ENABLE ROW LEVEL SECURITY;

-- Dual-provider control plane (migration 024).
CREATE TABLE IF NOT EXISTS provider_deployments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  agent_instance_id TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('elevenlabs-convai', 'livekit-cascade', 'groq-gateway')),
  provider_deployment_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('staged', 'active', 'draining', 'retired', 'failed')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  launch_gate JSONB,
  activated_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (provider, provider_deployment_id),
  FOREIGN KEY (client_id, agent_instance_id) REFERENCES agent_instances(client_id, id),
  CHECK (provider <> 'groq-gateway' OR status = 'retired')
);
CREATE UNIQUE INDEX IF NOT EXISTS provider_deployments_one_active_per_client_idx
  ON provider_deployments(client_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS provider_switch_operations (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  from_deployment_id TEXT,
  to_deployment_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'rolling_back', 'rolled_back', 'failed')),
  rollback_snapshot_id TEXT,
  requested_by TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (client_id, id), UNIQUE (client_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS provider_rollback_snapshots (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  switch_operation_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('elevenlabs-convai', 'livekit-cascade', 'groq-gateway')),
  deployment_id TEXT,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id), UNIQUE (client_id, switch_operation_id)
);

CREATE TABLE IF NOT EXISTS provider_usage_cost_events (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('elevenlabs-convai', 'livekit-cascade')),
  provider_event_id TEXT NOT NULL,
  call_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  usage_quantity NUMERIC(20, 6) NOT NULL CHECK (usage_quantity >= 0),
  usage_unit TEXT NOT NULL CHECK (usage_unit IN ('seconds', 'minutes', 'tokens', 'characters', 'calls')),
  cost_minor BIGINT NOT NULL CHECK (cost_minor >= 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id), UNIQUE (client_id, provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS provider_account_snapshots (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('elevenlabs-convai', 'livekit-cascade')),
  scope TEXT NOT NULL DEFAULT 'account' CHECK (scope = 'account'),
  status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'unavailable')),
  usage JSONB NOT NULL DEFAULT '{}'::jsonb,
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  cost JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, captured_at)
);

CREATE TABLE IF NOT EXISTS provider_alert_rules (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider TEXT CHECK (provider IN ('elevenlabs-convai', 'livekit-cascade')),
  metric TEXT NOT NULL CHECK (metric IN ('cost_minor', 'usage_quantity', 'error_rate', 'latency_ms')),
  operator TEXT NOT NULL CHECK (operator IN ('gt', 'gte')),
  threshold NUMERIC(20, 6) NOT NULL CHECK (threshold >= 0),
  window_minutes INT NOT NULL CHECK (window_minutes > 0),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id)
);
