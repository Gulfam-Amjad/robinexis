CREATE TABLE IF NOT EXISTS operator_audit_log (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operator_audit_log_client_created_idx
  ON operator_audit_log(client_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_operator_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'operator_audit_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS operator_audit_log_immutable ON operator_audit_log;
CREATE TRIGGER operator_audit_log_immutable
BEFORE UPDATE OR DELETE ON operator_audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_operator_audit_mutation();
