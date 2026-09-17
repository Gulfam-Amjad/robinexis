-- Customer-owned Twilio API-key imports require the Account Auth Token for
-- ElevenLabs inbound signature validation. Keep it encrypted per tenant.

ALTER TABLE twilio_connections
  ADD COLUMN IF NOT EXISTS encrypted_account_auth_token TEXT;
