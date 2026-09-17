/**
 * Rebuilds a tenant's Cal.com event types and the calendar_event_types mappings
 * the voice tools book against. Written for recovery: the Robinexis Cal.com
 * account lost its event types during the organisation migration, which made
 * every /slots and /bookings call return "Event Type not found".
 *
 * Reads DATABASE_URL and CALCOM_API_KEY from .env. Dry run by default.
 *
 *   node scripts/restore-calcom-event-types.mjs client_blades_hair
 *   node scripts/restore-calcom-event-types.mjs client_blades_hair --apply
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const hidden = args.includes("--hidden");
const clientId = args.find((arg) => !arg.startsWith("--")) || "client_blades_hair";

function loadEnv() {
  const env = {};
  let raw = "";
  try {
    raw = readFileSync(path.join(root, ".env"), "utf8");
  } catch {
    return env;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const fileEnv = loadEnv();
function required(name) {
  const value = (process.env[name] || fileEnv[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const CAL_API_BASE = (process.env.CALCOM_API_BASE_URL || fileEnv.CALCOM_API_BASE_URL || "https://api.cal.com/v2")
  .replace(/\/+$/, "");

async function calcom(apiKey, pathname, version, init) {
  const res = await fetch(`${CAL_API_BASE}${pathname}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${apiKey}`,
      "cal-api-version": version,
    },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`Cal.com ${init?.method || "GET"} ${pathname} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return json;
}

/** Mirrors providerServiceSlug in apps/api/src/provisioningService.ts. */
function providerServiceSlug(clientSlug, serviceSlug) {
  return `${clientSlug}-${serviceSlug}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

/**
 * A tenant may list several services against one calendar slug (Blades sells
 * four different 30-minute services). One provider event type serves them all.
 */
function uniqueServices(services) {
  const bySlug = new Map();
  for (const service of services) {
    const existing = bySlug.get(service.slug);
    if (!existing) {
      bySlug.set(service.slug, { ...service, shared: 1 });
      continue;
    }
    existing.durationMinutes = Math.max(existing.durationMinutes, service.durationMinutes);
    existing.shared += 1;
  }
  return [...bySlug.values()].map((service) => ({
    ...service,
    title: service.shared > 1 ? `${service.durationMinutes} minute appointment` : service.title,
  }));
}

async function main() {
  const apiKey = required("CALCOM_API_KEY");
  const pool = new pg.Pool({
    connectionString: required("DATABASE_URL"),
    ssl: { rejectUnauthorized: false },
  });

  try {
    const clientRow = await pool.query("SELECT id, slug, config FROM clients WHERE id = $1", [clientId]);
    if (!clientRow.rows[0]) throw new Error(`client_not_found: ${clientId}`);
    const config = clientRow.rows[0].config;
    const businessName = config.businessName || clientRow.rows[0].slug;
    const clientSlug = clientRow.rows[0].slug;
    const services = uniqueServices(config.services || []);
    if (!services.length) throw new Error("client has no services");

    const connectionRow = await pool.query(
      "SELECT id FROM calendar_connections WHERE client_id = $1 AND provider = 'calcom' ORDER BY status = 'active' DESC LIMIT 1",
      [clientId],
    );
    const calendarConnectionId = connectionRow.rows[0]?.id;
    if (!calendarConnectionId) throw new Error("no calcom calendar_connections row for this client");

    const hasReadinessOnly = (await pool.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_event_types' AND column_name = 'readiness_only'",
    )).rowCount > 0;

    const existing = (await pool.query(
      "SELECT id, service_slug, provider_event_type_id, provider_slug, created_at FROM calendar_event_types WHERE client_id = $1",
      [clientId],
    )).rows;

    const remote = ((await calcom(apiKey, "/event-types", "2024-06-14")).data || []).map((item) => ({
      id: Number(item.id),
      slug: String(item.slug || ""),
      title: String(item.title || ""),
      lengthInMinutes: Number(item.lengthInMinutes || item.length || 0),
    }));

    console.log(`Client  : ${businessName} (${clientId}, slug ${clientSlug})`);
    console.log(`Calendar: connection ${calendarConnectionId}`);
    console.log(`Remote  : ${remote.length} existing Cal.com event types`);
    console.log(`Mode    : ${apply ? "APPLY" : "dry run"}${hidden ? " (hidden event types)" : ""}`);
    console.log("");

    const planned = [
      ...services.map((service) => ({
        serviceSlug: service.slug,
        title: `${businessName} — ${service.title}`,
        durationMinutes: service.durationMinutes,
        readinessOnly: false,
      })),
      {
        serviceSlug: "__robinexis_readiness__",
        providerSlugOverride: providerServiceSlug(clientSlug, "robinexis-readiness-test"),
        title: `${businessName} — Robinexis readiness test`,
        durationMinutes: 15,
        readinessOnly: true,
      },
    ];

    for (const item of planned) {
      if (item.readinessOnly && !hasReadinessOnly) {
        console.log(`SKIP  ${item.providerSlugOverride} — readiness_only column missing (migration 021 not applied)`);
        continue;
      }
      const providerSlug = item.providerSlugOverride || providerServiceSlug(clientSlug, item.serviceSlug);
      const mapping = existing.find((row) => row.service_slug === item.serviceSlug);
      const match = remote.find(
        (event) => String(event.id) === mapping?.provider_event_type_id || event.slug === providerSlug,
      );

      if (!apply) {
        console.log(`${match ? "UPDATE" : "CREATE"} ${providerSlug} (${item.durationMinutes}m) -> ${item.title}`);
        continue;
      }

      const body = {
        title: item.title,
        slug: providerSlug,
        lengthInMinutes: item.durationMinutes,
        ...(hidden ? { hidden: true } : {}),
      };
      const saved = match
        ? (await calcom(apiKey, `/event-types/${match.id}`, "2024-06-14", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })).data
        : (await calcom(apiKey, "/event-types", "2024-06-14", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })).data;

      const now = new Date().toISOString();
      const columns = [
        "id", "client_id", "calendar_connection_id", "service_slug", "provider_event_type_id",
        "provider_slug", "title", "duration_minutes", "status", "created_at", "updated_at",
        ...(hasReadinessOnly ? ["readiness_only"] : []),
      ];
      const values = [
        mapping?.id || `calendar_event_${clientId}_${item.serviceSlug}`.replace(/[^a-zA-Z0-9_]/g, "_"),
        clientId,
        calendarConnectionId,
        item.serviceSlug,
        String(saved.id),
        String(saved.slug || providerSlug),
        item.title,
        item.durationMinutes,
        "active",
        mapping?.created_at ? new Date(mapping.created_at).toISOString() : now,
        now,
        ...(hasReadinessOnly ? [item.readinessOnly] : []),
      ];
      await pool.query(
        `INSERT INTO calendar_event_types (${columns.join(", ")})
         VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})
         ON CONFLICT (client_id, service_slug) DO UPDATE SET
           calendar_connection_id = EXCLUDED.calendar_connection_id,
           provider_event_type_id = EXCLUDED.provider_event_type_id,
           provider_slug = EXCLUDED.provider_slug,
           title = EXCLUDED.title,
           duration_minutes = EXCLUDED.duration_minutes,
           status = EXCLUDED.status,
           ${hasReadinessOnly ? "readiness_only = EXCLUDED.readiness_only," : ""}
           updated_at = EXCLUDED.updated_at`,
        values,
      );
      console.log(`${match ? "UPDATED" : "CREATED"} ${saved.slug} id=${saved.id} (${item.durationMinutes}m)`);
    }

    if (apply) {
      console.log("");
      const start = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();
      const rows = (await pool.query(
        "SELECT provider_slug, provider_event_type_id FROM calendar_event_types WHERE client_id = $1 ORDER BY provider_slug",
        [clientId],
      )).rows;
      for (const row of rows) {
        const params = new URLSearchParams({ eventTypeId: row.provider_event_type_id, start, end });
        try {
          const slots = await calcom(apiKey, `/slots?${params.toString()}`, "2024-09-04");
          const count = Object.values(slots.data || {}).reduce((total, day) => total + day.length, 0);
          console.log(`SLOTS ${row.provider_slug} -> ${count} available in the next 7 days`);
        } catch (error) {
          console.log(`SLOTS ${row.provider_slug} -> FAILED ${String(error).slice(0, 200)}`);
        }
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
