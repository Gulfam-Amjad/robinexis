import pg from "pg";

const environment = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || "";
if (environment !== "production") throw new Error("production environment required");
const expectedAgent = "agent_6101m1c3n4wnfsgskgzr13w2gt9s";
const expectedNumber = "+447446868067";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" },
});
const [clientResult, subscriptions, connections, eventTypes, endpoints] = await Promise.all([
  pool.query("SELECT config FROM clients WHERE id='client_blades_hair'"),
  pool.query(
    "SELECT status,plan_tier,provider_subscription_id IS NOT NULL AS provider_subscription_present FROM subscriptions WHERE client_id='client_blades_hair' ORDER BY updated_at DESC",
  ),
  pool.query(
    "SELECT provider,status,calendar_id IS NOT NULL AS calendar_present FROM calendar_connections WHERE client_id='client_blades_hair' ORDER BY id",
  ),
  pool.query(
    "SELECT service_slug,status,provider_event_type_id IS NOT NULL AS event_type_present FROM calendar_event_types WHERE client_id='client_blades_hair' ORDER BY service_slug",
  ),
  pool.query(
    "SELECT provider,status,e164,provider_endpoint_id IS NOT NULL AS endpoint_present FROM phone_endpoints WHERE client_id='client_blades_hair' ORDER BY id",
  ),
]);
await pool.end();
const config = clientResult.rows[0]?.config || {};
const identitySafe = config.elevenlabsAgentId === expectedAgent &&
  Array.isArray(config.inboundNumbers) &&
  config.inboundNumbers.includes(expectedNumber);
console.log(JSON.stringify({
  ok: identitySafe && clientResult.rowCount === 1,
  identitySafe,
  client: {
    serviceStatus: config.serviceStatus,
    onboardingStatus: config.onboardingStatus,
    subscribedProduct: config.subscribedProduct,
    stripeCustomerPresent: Boolean(config.stripeCustomerId),
    stripeSubscriptionPresent: Boolean(config.stripeSubscriptionId),
    published: Boolean(config.published),
    voicePipeline: config.voicePipeline,
  },
  subscriptions: subscriptions.rows,
  calendarConnections: connections.rows,
  calendarEventTypes: eventTypes.rows,
  phoneEndpoints: endpoints.rows,
}));
