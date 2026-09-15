-- Cal.com gates OAuth clients and managed users behind a Platform organisation
-- ("Organization is not a platform"). Until that plan is bought, tenants book
-- through the Robinexis account and isolation is enforced by tenant-prefixed
-- event type slugs plus the per-tenant calendar_event_types mapping.
DO $$
BEGIN
  ALTER TABLE calendar_connections DROP CONSTRAINT IF EXISTS calendar_connections_mode_check;
  ALTER TABLE calendar_connections
    ADD CONSTRAINT calendar_connections_mode_check
    CHECK (connection_mode IS NULL OR connection_mode IN ('oauth', 'managed', 'legacy', 'shared'));
END
$$;
