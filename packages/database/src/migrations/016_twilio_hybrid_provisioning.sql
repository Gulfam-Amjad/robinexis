ALTER TABLE twilio_connections
  ADD COLUMN IF NOT EXISTS selected_phone_number TEXT,
  ADD COLUMN IF NOT EXISTS regulatory_bundle_sid TEXT,
  ADD COLUMN IF NOT EXISTS emergency_address_sid TEXT,
  ADD COLUMN IF NOT EXISTS monthly_spend_cap_pence INTEGER,
  ADD COLUMN IF NOT EXISTS purchase_confirmed_by TEXT,
  ADD COLUMN IF NOT EXISTS purchase_confirmed_at TIMESTAMPTZ;

ALTER TABLE twilio_connections
  DROP CONSTRAINT IF EXISTS twilio_connections_selected_phone_number_check,
  ADD CONSTRAINT twilio_connections_selected_phone_number_check
    CHECK (selected_phone_number IS NULL OR selected_phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  DROP CONSTRAINT IF EXISTS twilio_connections_monthly_spend_cap_check,
  ADD CONSTRAINT twilio_connections_monthly_spend_cap_check
    CHECK (monthly_spend_cap_pence IS NULL OR monthly_spend_cap_pence >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS phone_endpoints_one_active_twilio_per_tenant
  ON phone_endpoints(client_id, provider)
  WHERE provider = 'twilio' AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS provider_resources_one_active_twilio_number_per_tenant
  ON provider_resources(client_id, provider, resource_type)
  WHERE provider = 'twilio' AND resource_type = 'phone_number'
    AND lifecycle_status IN ('provisioning', 'active');

