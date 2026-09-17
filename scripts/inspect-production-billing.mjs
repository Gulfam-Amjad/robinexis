import { config as loadEnv } from "dotenv";
import pg from "pg";

loadEnv({ path: ".env", quiet: true });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  const result = await pool.query(
    `SELECT c.id,
            c.slug,
            c.config->>'serviceStatus' AS status,
            c.config->>'stripeCustomerId' AS customer_id,
            c.config->>'stripeSubscriptionId' AS subscription_id,
            s.provider,
            s.status AS subscription_status
     FROM clients c
     LEFT JOIN subscriptions s ON s.client_id = c.id
     ORDER BY c.id`,
  );
  console.log(JSON.stringify(result.rows, null, 2));
} finally {
  await pool.end();
}
