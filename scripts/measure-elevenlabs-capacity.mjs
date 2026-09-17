/**
 * Read-only ElevenLabs shared-account meter. Prints used / remaining / reset.
 * Never logs the API key. Does not change agents, phones, or Blades.
 */
import { config } from "dotenv";

config({ path: ".env", quiet: true });

const key = process.env.ELEVENLABS_API_KEY?.trim();
if (!key) {
  console.error("ELEVENLABS_API_KEY is not set in the environment.");
  process.exit(2);
}

const response = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
  headers: { "xi-api-key": key },
});
if (!response.ok) {
  console.error(`ElevenLabs subscription lookup failed: ${response.status}`);
  process.exit(1);
}

const body = await response.json();
const used = Number(body.character_count);
const limit = Number(body.character_limit);
const remaining = Number.isFinite(used) && Number.isFinite(limit) ? Math.max(0, limit - used) : undefined;
const resetAt = body.next_character_count_reset_unix
  ? new Date(body.next_character_count_reset_unix * 1000).toISOString()
  : undefined;

console.log(JSON.stringify({
  capturedAt: new Date().toISOString(),
  provider: "elevenlabs",
  scope: "shared_account",
  tier: body.tier || "unknown",
  status: body.status || "unknown",
  charactersUsed: Number.isFinite(used) ? used : null,
  characterLimit: Number.isFinite(limit) ? limit : null,
  charactersRemaining: remaining ?? null,
  percentUsed: remaining !== undefined && limit > 0 ? Math.round((used / limit) * 100) : null,
  resetAt: resetAt || null,
  canExtendCharacterLimit: Boolean(body.can_extend_character_limit),
}, null, 2));
