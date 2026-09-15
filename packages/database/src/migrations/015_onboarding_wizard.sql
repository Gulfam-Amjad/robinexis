-- Resumable, tenant-scoped onboarding wizard state. Provider credentials and
-- resources remain outside this customer-authored document.

CREATE TABLE IF NOT EXISTS onboarding_wizard_states (
  client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  current_step TEXT NOT NULL DEFAULT 'website'
    CHECK (current_step IN ('website','facts','behavior','operations','phone','calendar','review')),
  completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(completed_steps) = 'array'),
  CHECK (jsonb_typeof(data) = 'object')
);

ALTER TABLE public.onboarding_wizard_states ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.onboarding_wizard_states FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.onboarding_wizard_states FROM authenticated;
  END IF;
END
$$;
