import Redis from "ioredis";
import { sha256Hex } from "./auth/crypto";
import { buildRedisConnectionUrl } from "./presence/presence-store";

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(input: { key: string; rule: RateLimitRule; now?: Date }): Promise<RateLimitDecision>;
  close?(): Promise<void>;
}

export class RateLimitExceededError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message);
    this.name = "RateLimitExceededError";
  }
}

export const HTTP_RATE_LIMITS = {
  authRegister: { limit: 5, windowSeconds: 10 * 60 },
  authLogin: { limit: 10, windowSeconds: 10 * 60 },
  authRefresh: { limit: 60, windowSeconds: 60 },
  deviceToken: { limit: 20, windowSeconds: 10 * 60 },
  pairingCreate: { limit: 20, windowSeconds: 5 * 60 },
  pairingClaim: { limit: 12, windowSeconds: 5 * 60 },
  pairingJoin: { limit: 12, windowSeconds: 5 * 60 },
  rpcWebSocket: { limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export class MemoryRateLimiter implements RateLimiter {
  private readonly entries = new Map<string, { count: number; resetAtMs: number }>();

  async consume(input: { key: string; rule: RateLimitRule; now?: Date }): Promise<RateLimitDecision> {
    const nowMs = input.now?.getTime() ?? Date.now();
    const existing = this.entries.get(input.key);
    const resetAtMs =
      existing && existing.resetAtMs > nowMs ? existing.resetAtMs : nowMs + input.rule.windowSeconds * 1000;
    const count = existing && existing.resetAtMs > nowMs ? existing.count + 1 : 1;
    this.entries.set(input.key, { count, resetAtMs });
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
    return {
      allowed: count <= input.rule.limit,
      remaining: Math.max(0, input.rule.limit - count),
      retryAfterSeconds,
    };
  }
}

export class RedisRateLimiter implements RateLimiter {
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor(input: { redisUrl: string; redisPassword?: string; keyPrefix?: string }) {
    this.redis = new Redis(buildRedisConnectionUrl(input.redisPassword, input.redisUrl));
    this.keyPrefix = input.keyPrefix ?? "eco:rate:";
  }

  async consume(input: { key: string; rule: RateLimitRule }): Promise<RateLimitDecision> {
    const result = await this.redis.eval(
      `
      local count = redis.call("INCR", KEYS[1])
      if count == 1 then
        redis.call("EXPIRE", KEYS[1], ARGV[1])
      end
      local ttl = redis.call("TTL", KEYS[1])
      return { count, ttl }
      `,
      1,
      `${this.keyPrefix}${input.key}`,
      String(input.rule.windowSeconds),
    );
    const [countRaw, ttlRaw] = Array.isArray(result) ? result : [1, input.rule.windowSeconds];
    const count = Number(countRaw);
    const ttl = Number(ttlRaw);
    const retryAfterSeconds = Number.isFinite(ttl) && ttl > 0 ? Math.ceil(ttl) : input.rule.windowSeconds;
    return {
      allowed: count <= input.rule.limit,
      remaining: Math.max(0, input.rule.limit - count),
      retryAfterSeconds,
    };
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}

export async function buildRateLimitKey(scope: string, parts: readonly string[]): Promise<string> {
  return `${scope}:${await sha256Hex(JSON.stringify(parts))}`;
}
