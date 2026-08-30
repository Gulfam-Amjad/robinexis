import { createClient, type RedisClientType } from "redis";
import { structuredLog } from "./access.js";
import type { CallSession } from "./types.js";

const TTL_SEC = 60 * 60 * 4;

export class RedisSessionCache {
  private client: RedisClientType | null = null;
  private localReservations = new Map<string, Map<string, number>>();

  constructor(private url?: string) {}

  async connect() {
    if (!this.url) return;
    this.client = createClient({ url: this.url });
    this.client.on("error", (err) => structuredLog("redis_error", { err: String(err) }));
    await this.client.connect();
  }

  async setCall(call: CallSession) {
    const key = `call:${call.clientId}:${call.id}`;
    if (!this.client) return;
    await this.client.set(key, JSON.stringify(call), { EX: TTL_SEC });
  }

  async getCall(clientId: string, callId: string): Promise<CallSession | undefined> {
    if (!this.client) return undefined;
    const raw = await this.client.get(`call:${clientId}:${callId}`);
    return raw ? (JSON.parse(raw) as CallSession) : undefined;
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    return (await this.client.ping()) === "PONG";
  }

  async reserveCallSlot(
    clientId: string,
    reservationId: string,
    limit: number,
    ttlMs = 120_000,
  ): Promise<boolean> {
    const now = Date.now();
    const expires = now + ttlMs;
    if (!this.client) {
      const slots = this.localReservations.get(clientId) ?? new Map<string, number>();
      for (const [id, expiry] of slots) if (expiry <= now) slots.delete(id);
      if (slots.size >= limit) return false;
      slots.set(reservationId, expires);
      this.localReservations.set(clientId, slots);
      return true;
    }
    const key = `active-calls:${clientId}`;
    const result = await this.client.eval(
      `redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
       if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
       redis.call('ZADD', KEYS[1], ARGV[2], ARGV[4])
       redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[5]))
       return 1`,
      {
        keys: [key],
        arguments: [String(now), String(expires), String(limit), reservationId, String(ttlMs + 60_000)],
      },
    );
    return Number(result) === 1;
  }

  async refreshCallSlot(clientId: string, reservationId: string, ttlMs = TTL_SEC * 1000) {
    const expires = Date.now() + ttlMs;
    if (!this.client) {
      const slots = this.localReservations.get(clientId);
      if (slots?.has(reservationId)) slots.set(reservationId, expires);
      return;
    }
    await this.client.zAdd(`active-calls:${clientId}`, [{ score: expires, value: reservationId }]);
  }

  async releaseCallSlot(clientId: string, reservationId: string) {
    if (!this.client) {
      this.localReservations.get(clientId)?.delete(reservationId);
      return;
    }
    await this.client.zRem(`active-calls:${clientId}`, reservationId);
  }

  async activeCallCount(clientId: string): Promise<number> {
    const now = Date.now();
    if (!this.client) {
      const slots = this.localReservations.get(clientId) ?? new Map<string, number>();
      for (const [id, expiry] of slots) if (expiry <= now) slots.delete(id);
      return slots.size;
    }
    const key = `active-calls:${clientId}`;
    await this.client.zRemRangeByScore(key, 0, now);
    return this.client.zCard(key);
  }
}
