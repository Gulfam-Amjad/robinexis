ALTER TABLE phone_endpoints
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS calendar_event_types (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  calendar_connection_id TEXT NOT NULL,
  service_slug TEXT NOT NULL,
  provider_event_type_id TEXT NOT NULL,
  provider_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'disabled', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (client_id, service_slug),
  UNIQUE (provider_slug),
  FOREIGN KEY (client_id, calendar_connection_id)
    REFERENCES calendar_connections(client_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS calendar_event_types_client_idx
  ON calendar_event_types(client_id);

ALTER TABLE calendar_event_types ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.calendar_event_types FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.calendar_event_types FROM authenticated;
  END IF;
END
$$;
