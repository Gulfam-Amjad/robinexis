-- Durable ownership for provisioning and two-phase provider activation.

ALTER TABLE provisioning_runs
  ADD COLUMN IF NOT EXISTS claim_token TEXT;

ALTER TABLE provisioning_runs DROP CONSTRAINT IF EXISTS provisioning_runs_status_check;
ALTER TABLE provisioning_runs
  ADD CONSTRAINT provisioning_runs_status_check
  CHECK (status IN (
    'pending','running','paused','succeeded','activation_pending','activating','failed','cancelled'
  ));

CREATE INDEX IF NOT EXISTS provisioning_runs_stale_claim_idx
  ON provisioning_runs(status, updated_at)
  WHERE status = 'running';

ALTER TABLE calendar_event_types
  ADD COLUMN IF NOT EXISTS readiness_only BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_types_one_readiness_per_tenant
  ON calendar_event_types(client_id)
  WHERE readiness_only;
