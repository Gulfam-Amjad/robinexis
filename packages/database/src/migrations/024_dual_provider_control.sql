-- Provider-neutral SaaS control plane. This migration stores operational usage
-- and cost observations; customer minute entitlements remain in credit_ledger.

ALTER TABLE agent_instances DROP CONSTRAINT IF EXISTS agent_instances_provider_check;
ALTER TABLE agent_instances
  ADD CONSTRAINT agent_instances_provider_check
  CHECK (provider IN ('elevenlabs', 'livekit'));

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
CREATE INDEX IF NOT EXISTS provider_deployments_client_idx
  ON provider_deployments(client_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS provider_deployments_one_active_per_client_idx
  ON provider_deployments(client_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS provider_switch_operations (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  from_deployment_id TEXT,
  to_deployment_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'running', 'succeeded', 'rolling_back', 'rolled_back', 'failed')
  ),
  rollback_snapshot_id TEXT,
  requested_by TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (client_id, id),
  UNIQUE (client_id, idempotency_key),
  FOREIGN KEY (client_id, from_deployment_id) REFERENCES provider_deployments(client_id, id),
  FOREIGN KEY (client_id, to_deployment_id) REFERENCES provider_deployments(client_id, id)
);
CREATE INDEX IF NOT EXISTS provider_switch_operations_client_idx
  ON provider_switch_operations(client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_rollback_snapshots (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  switch_operation_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('elevenlabs-convai', 'livekit-cascade', 'groq-gateway')),
  deployment_id TEXT,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (client_id, switch_operation_id),
  FOREIGN KEY (client_id, switch_operation_id) REFERENCES provider_switch_operations(client_id, id),
  FOREIGN KEY (client_id, deployment_id) REFERENCES provider_deployments(client_id, id)
);
ALTER TABLE provider_switch_operations
  ADD CONSTRAINT provider_switch_operations_rollback_snapshot_fk
  FOREIGN KEY (client_id, rollback_snapshot_id)
  REFERENCES provider_rollback_snapshots(client_id, id);

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
  UNIQUE (client_id, id),
  UNIQUE (client_id, provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS provider_usage_cost_events_client_occurred_idx
  ON provider_usage_cost_events(client_id, occurred_at DESC);

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
CREATE INDEX IF NOT EXISTS provider_account_snapshots_latest_idx
  ON provider_account_snapshots(provider, captured_at DESC);

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
CREATE INDEX IF NOT EXISTS provider_alert_rules_client_idx
  ON provider_alert_rules(client_id, enabled);

ALTER TABLE provider_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_switch_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_rollback_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_usage_cost_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_account_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_alert_rules ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.provider_deployments FROM anon, authenticated;
REVOKE ALL ON public.provider_switch_operations FROM anon, authenticated;
REVOKE ALL ON public.provider_rollback_snapshots FROM anon, authenticated;
REVOKE ALL ON public.provider_usage_cost_events FROM anon, authenticated;
REVOKE ALL ON public.provider_account_snapshots FROM anon, authenticated;
REVOKE ALL ON public.provider_alert_rules FROM anon, authenticated;
