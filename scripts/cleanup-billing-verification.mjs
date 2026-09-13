import { config as loadEnv } from "dotenv";
import pg from "pg";
import Stripe from "stripe";

loadEnv({ path: ".env", quiet: true });

const clientId = process.argv[2];
const checkoutSessionId = process.argv[3];
if (!clientId || clientId === "client_blades_hair" || !checkoutSessionId?.startsWith("cs_live_")) {
  throw new Error("Pass the disposable client and live Checkout session IDs");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

try {
  const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
  if (session.client_reference_id !== clientId || session.status !== "open") {
    throw new Error("Checkout session is not the expected open disposable session");
  }
  await stripe.checkout.sessions.expire(checkoutSessionId);

  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    const client = await connection.query(
      `SELECT id,
              config->>'email' AS email,
              config->>'published' AS published,
              config->'inboundNumbers' AS inbound_numbers
       FROM clients
       WHERE id = $1
       FOR UPDATE`,
      [clientId],
    );
    const row = client.rows[0];
    if (
      row?.email !== "hammadmuntazir512+checkout@gmail.com" ||
      row.published !== "false" ||
      JSON.stringify(row.inbound_numbers) !== "[]"
    ) {
      throw new Error("Disposable tenant guard failed; refusing cleanup");
    }
    const events = await connection.query(
      `DELETE FROM stripe_events
       WHERE client_id = $1
         AND id LIKE 'evt_safe_%'`,
      [clientId],
    );
    const clients = await connection.query(
      "DELETE FROM clients WHERE id = $1",
      [clientId],
    );
    await connection.query("COMMIT");
    console.log(JSON.stringify({
      ok: true,
      checkoutExpired: true,
      clientsDeleted: clients.rowCount,
      webhookEventsDeleted: events.rowCount,
    }));
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
} finally {
  await pool.end();
}
