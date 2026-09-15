-- Durable onboarding lifecycle data. All tables are API/worker-only: RLS is
-- enabled without browser policies and browser roles are explicitly revoked.

CREATE TABLE IF NOT EXISTS onboarding_jobs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'completed', 'dead_letter')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (client_id, idempotency_key),
  CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS onboarding_jobs_claim_idx
  ON onboarding_jobs(status, available_at, lease_expires_at, created_at);

INSERT INTO onboarding_jobs (
  id, client_id, kind, idempotency_key, status, payload, attempt_count,
  max_attempts, available_at, created_at, updated_at
)
SELECT
  'job_' || id, client_id, 'provision_client', 'provision:' || idempotency_key,
  'pending', jsonb_build_object('operationKey', idempotency_key), 0, 5,
  now(), created_at, now()
FROM provisioning_runs
WHERE status IN ('pending', 'failed')
  AND client_id <> 'client_blades_hair'
ON CONFLICT (client_id, idempotency_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS onboarding_outbox (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (client_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS onboarding_outbox_pending_idx
  ON onboarding_outbox(created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS website_sources (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'disabled', 'failed')),
  checksum TEXT,
  last_fetched_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (client_id, url)
);

CREATE TABLE IF NOT EXISTS website_extraction_runs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  extractor_version TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  FOREIGN KEY (client_id, source_id) REFERENCES website_sources(client_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS extracted_facts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  extraction_run_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  confidence NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
  source_evidence TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (client_id, extraction_run_id, key),
  FOREIGN KEY (client_id, extraction_run_id)
    REFERENCES website_extraction_runs(client_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS onboarding_gaps (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'waived')),
  detail TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (client_id, key)
);

CREATE TABLE IF NOT EXISTS provider_resources (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('elevenlabs','twilio','calcom','google','outlook','fresha')),
  resource_type TEXT NOT NULL,
  provider_resource_id TEXT,
  lifecycle_status TEXT NOT NULL CHECK (
    lifecycle_status IN ('pending','provisioning','active','deleting','deleted','failed')
  ),
  credential_ref TEXT,
  encrypted_credential TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (provider, provider_resource_id),
  CHECK (credential_ref IS NULL OR credential_ref ~ '^[A-Z][A-Z0-9_]*$')
);
CREATE INDEX IF NOT EXISTS provider_resources_client_idx
  ON provider_resources(client_id, lifecycle_status);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'onboarding_jobs', 'onboarding_outbox', 'website_sources',
    'website_extraction_runs', 'extracted_facts', 'onboarding_gaps', 'provider_resources'
  ] LOOP
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
