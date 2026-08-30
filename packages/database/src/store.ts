import { databaseUrlFromEnv, isProductionRuntime } from "./env.js";
import { MemoryStore, type PlatformStore } from "./memory.js";
import { createPool, PostgresStore } from "./postgres.js";
import { RedisSessionCache } from "./redis.js";

let store: PlatformStore | undefined;
let redis: RedisSessionCache | undefined;
let pool: ReturnType<typeof createPool> | undefined;

export async function getStore(): Promise<PlatformStore> {
  if (store) return store;
  const url = databaseUrlFromEnv();
  const requireDatabase = process.env.REQUIRE_DATABASE === "true" || isProductionRuntime();
  if (url && !url.includes("example")) {
    try {
      pool = createPool(url);
      await pool.query("SELECT 1");
      store = new PostgresStore(pool);
      return store;
    } catch (err) {
      if (requireDatabase) throw new Error(`Postgres is required but unavailable: ${String(err)}`);
      console.warn("[database] Postgres unavailable, using memory store:", err);
    }
  }
  if (requireDatabase) throw new Error("DATABASE_URL is required in production");
  store = new MemoryStore();
  return store;
}

export async function getRedis(): Promise<RedisSessionCache> {
  if (redis) return redis;
  redis = new RedisSessionCache(process.env.REDIS_URL);
  try {
    await redis.connect();
  } catch (err) {
    console.warn("[database] Redis unavailable:", err);
  }
  return redis;
}

export { MemoryStore, type PlatformStore };

