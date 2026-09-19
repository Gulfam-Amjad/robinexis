import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisSessionCache } from "@robinexis/database";
import { checkDistributedRateLimit } from "./rateLimit.js";

const redisUrl = process.env.TEST_REDIS_URL;
const describeRedis = redisUrl ? describe : describe.skip;
let first: RedisSessionCache;
let second: RedisSessionCache;

describeRedis("distributed Redis rate limiting", () => {
  beforeAll(async () => {
    first = new RedisSessionCache(redisUrl);
    second = new RedisSessionCache(redisUrl);
    await first.connect();
    await second.connect();
  });

  afterAll(async () => {
    await Promise.all([first.close(), second.close()]);
  });

  it("shares one limit across API process clients", async () => {
    const key = `integration:${Date.now()}:${Math.random()}`;
    expect((await checkDistributedRateLimit(first, key, 2, 10_000)).allowed).toBe(true);
    expect((await checkDistributedRateLimit(second, key, 2, 10_000)).allowed).toBe(true);
    expect(await checkDistributedRateLimit(first, key, 2, 10_000)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });
});
