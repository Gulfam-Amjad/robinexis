import type http from "node:http";
import type { RedisSessionCache } from "@robinexis/database";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export function requestIp(req: http.IncomingMessage): string {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs = 60_000,
  now = Date.now(),
): RateLimitResult {
  const existing = buckets.get(key);
  const bucket =
    !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : existing;
  bucket.count += 1;
  buckets.set(key, bucket);

  // Opportunistic bounded cleanup avoids a timer and keeps server shutdown simple.
  if (buckets.size > 10_000) {
    for (const [bucketKey, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  return {
    allowed: bucket.count <= limit,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
  };
}

export async function checkDistributedRateLimit(
  redis: RedisSessionCache,
  key: string,
  limit: number,
  windowMs = 60_000,
): Promise<RateLimitResult> {
  const distributed = await redis.incrementRateLimit(key, windowMs);
  if (!distributed) return checkRateLimit(key, limit, windowMs);
  return {
    allowed: distributed.count <= limit,
    limit,
    remaining: Math.max(0, limit - distributed.count),
    retryAfterSeconds: Math.max(1, Math.ceil(distributed.resetMs / 1_000)),
  };
}

export function limitForPath(pathname: string): number | undefined {
  if (pathname.startsWith("/api/v1/voice-tools/")) return 120;
  if (pathname.startsWith("/api/v1/")) return 240;
  if (pathname.startsWith("/webhooks/")) return 600;
  return undefined;
}

export function clearRateLimitsForTest() {
  buckets.clear();
}
