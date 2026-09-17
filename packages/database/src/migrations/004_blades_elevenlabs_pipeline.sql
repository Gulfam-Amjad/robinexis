-- The Blades Hair row predates the move to direct Twilio -> ElevenLabs and still
-- carries the retired groq-gateway pipeline, so the dashboard reported ElevenLabs
-- as unconnected even though the agent ID was present.
UPDATE clients
SET config = jsonb_set(
  config,
  '{voicePipeline}',
  '"elevenlabs-convai"'::jsonb,
  true
)
WHERE id = 'client_blades_hair'
  AND config->>'elevenlabsAgentId' IS NOT NULL
  AND config->>'voicePipeline' IS DISTINCT FROM 'elevenlabs-convai';
