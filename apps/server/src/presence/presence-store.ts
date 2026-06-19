import type { EcoDeviceKind } from "@eco/shared";

export const ECO_SERVER_REDIS_URL = "redis://127.0.0.1:6379";

export interface PresenceSession {
  sessionId: string;
  userId: string;
  deviceId: string;
  deviceKind: EcoDeviceKind;
  connectedAt: string;
  lastSeenAt: string;
}

export interface PresenceStore {
  setSession(session: PresenceSession): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  getSession(sessionId: string): Promise<PresenceSession | undefined>;
}

/** Test double only — production always uses Redis. */
export class MemoryPresenceStore implements PresenceStore {
  private readonly sessions = new Map<string, PresenceSession>();

  async setSession(session: PresenceSession): Promise<void> {
    this.sessions.set(session.sessionId, session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async getSession(sessionId: string): Promise<PresenceSession | undefined> {
    return this.sessions.get(sessionId);
  }
}

export interface RedisLike {
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
  close?: () => void;
}

export class RedisPresenceStore implements PresenceStore {
  private readonly redis: RedisLike;
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;

  constructor(redis: RedisLike, options: { ttlSeconds?: number; keyPrefix?: string } = {}) {
    this.redis = redis;
    this.ttlSeconds = options.ttlSeconds ?? 60;
    this.keyPrefix = options.keyPrefix ?? "eco:presence:";
  }

  async setSession(session: PresenceSession): Promise<void> {
    await this.redis.setex(this.key(session.sessionId), this.ttlSeconds, JSON.stringify(session));
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId));
  }

  async getSession(sessionId: string): Promise<PresenceSession | undefined> {
    const value = await this.redis.get(this.key(sessionId));
    if (!value) {
      return undefined;
    }
    const parsed = JSON.parse(value) as unknown;
    return isPresenceSession(parsed) ? parsed : undefined;
  }

  close(): void {
    this.redis.close?.();
  }

  private key(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }
}

export function buildRedisConnectionUrl(redisPassword?: string): string {
  const password = redisPassword?.trim();
  if (!password) {
    return ECO_SERVER_REDIS_URL;
  }
  const parsed = new URL(ECO_SERVER_REDIS_URL);
  parsed.password = password;
  return parsed.toString();
}

export function createRedisPresenceStore(redisPassword?: string): RedisPresenceStore {
  const client = new Bun.RedisClient(buildRedisConnectionUrl(redisPassword)) as RedisLike;
  return new RedisPresenceStore(client);
}

function isPresenceSession(value: unknown): value is PresenceSession {
  if (!value || typeof value !== "object") {
    return false;
  }
  const session = value as PresenceSession;
  return (
    typeof session.sessionId === "string" &&
    typeof session.userId === "string" &&
    typeof session.deviceId === "string" &&
    (session.deviceKind === "desktop" || session.deviceKind === "mobile") &&
    typeof session.connectedAt === "string" &&
    typeof session.lastSeenAt === "string"
  );
}
