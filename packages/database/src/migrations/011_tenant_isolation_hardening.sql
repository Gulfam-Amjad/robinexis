-- Event-type slugs are provider identifiers inside a tenant calendar connection,
-- not globally unique platform identifiers. Two salons may legitimately use
-- the same provider slug.
ALTER TABLE calendar_event_types
  DROP CONSTRAINT IF EXISTS calendar_event_types_provider_slug_key;

CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_types_client_provider_slug_uidx
  ON calendar_event_types(client_id, provider_slug);

-- A provider call ID may only ever belong to its original tenant. The API store
-- also checks this on UPSERT; this trigger protects direct/server-side writes.
CREATE OR REPLACE FUNCTION reject_call_session_tenant_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    RAISE EXCEPTION 'call_session tenant is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS call_session_tenant_immutable ON call_sessions;
CREATE TRIGGER call_session_tenant_immutable
BEFORE UPDATE OF client_id ON call_sessions
FOR EACH ROW EXECUTE FUNCTION reject_call_session_tenant_change();
