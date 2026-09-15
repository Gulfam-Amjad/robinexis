-- Additive correction for databases that already applied lifecycle migrations.

-- Blades is an assisted, protected live tenant and must never enter automation.
DELETE FROM onboarding_jobs WHERE client_id = 'client_blades_hair'
  AND kind = 'provision_client' AND status IN ('pending', 'leased', 'paused');

-- Historic crawl payloads could put up to 250k markdown characters in JSONB.
UPDATE website_sources
SET metadata = metadata - 'markdown', updated_at = now()
WHERE metadata ? 'markdown';

-- Provider identifiers are only unique inside a tenant. Replace the original
-- global constraint with a tenant-scoped key without rewriting migration 013.
ALTER TABLE provider_resources
  DROP CONSTRAINT IF EXISTS provider_resources_provider_provider_resource_id_key;
DROP INDEX IF EXISTS provider_resources_provider_provider_resource_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS provider_resources_tenant_provider_resource_idx
  ON provider_resources(client_id, provider, provider_resource_id)
  WHERE provider_resource_id IS NOT NULL;

-- A worker may extend a long provider operation beyond its initial lease.
CREATE INDEX IF NOT EXISTS onboarding_jobs_lease_owner_idx
  ON onboarding_jobs(client_id, id, lease_owner)
  WHERE status = 'leased';
