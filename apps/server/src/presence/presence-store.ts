import type { EcoDeviceKind } from "@eco/shared";
import Redis from "ioredis";

export const ECO_SERVER_REDIS_URL = "redis://127.0.0.1:6379";

export interface PresenceSession {
  sessionId: string;
  userId: string;
  deviceId: string;
  deviceKind: EcoDeviceKind;
  connectedAt: string;
  lastSeenAt: string;
}

export interface DeviceRoute extends PresenceSession {
  instanceId: string;
}

export interface PresenceStore {
  setSession(session: PresenceSession): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  getSession(sessionId: string): Promise<PresenceSession | undefined>;
  setDeviceRoute(route: DeviceRoute): Promise<void>;
  deleteDeviceRoute(input: { deviceId: string; userId: string; sessionId: string }): Promise<void>;
  getDeviceRoute(deviceId: string): Promise<DeviceRoute | undefined>;
  listDeviceRoutesForUser(userId: string): Promise<DeviceRoute[]>;
}

/** Test double only — production always uses Redis. */
export class MemoryPresenceStore implements PresenceStore {
  private readonly sessions = new Map<string, PresenceSession>();
  private readonly deviceRoutes = new Map<string, DeviceRoute>();

  async setSession(session: PresenceSession): Promise<void> {
    this.sessions.set(session.sessionId, session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async getSession(sessionId: string): Promise<PresenceSession | undefined> {
    return this.sessions.get(sessionId);
  }

  async setDeviceRoute(route: DeviceRoute): Promise<void> {
    this.deviceRoutes.set(route.deviceId, route);
  }

  async deleteDeviceRoute(input: { deviceId: string; userId: string; sessionId: string }): Promise<void> {
    const route = this.deviceRoutes.get(input.deviceId);
    if (route?.userId === input.userId && route.sessionId === input.sessionId) {
      this.deviceRoutes.delete(input.deviceId);
    }
  }

  async getDeviceRoute(deviceId: string): Promise<DeviceRoute | undefined> {
    return this.deviceRoutes.get(deviceId);
  }

  async listDeviceRoutesForUser(userId: string): Promise<DeviceRoute[]> {
    return Array.from(this.deviceRoutes.values()).filter((route) => route.userId === userId);
  }
}

export interface RedisLike {
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
  sadd(key: string, member: string): Promise<unknown>;
  srem(key: string, member: string): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
  eval(script: string, keys: number, ...args: string[]): Promise<unknown>;
  quit?: () => Promise<unknown>;
  disconnect?: () => void;
}

export class RedisPresenceStore implements PresenceStore {
  private readonly redis: RedisLike;
  private readonly ttlSeconds: number;
  private readonly sessionKeyPrefix: string;
  private readonly routeKeyPrefix: string;
  private readonly userRoutesKeyPrefix: string;

  constructor(
    redis: RedisLike,
    options: {
      ttlSeconds?: number;
      sessionKeyPrefix?: string;
      routeKeyPrefix?: string;
      userRoutesKeyPrefix?: string;
    } = {},
  ) {
    this.redis = redis;
    this.ttlSeconds = options.ttlSeconds ?? 60;
    this.sessionKeyPrefix = options.sessionKeyPrefix ?? "eco:presence:session:";
    this.routeKeyPrefix = options.routeKeyPrefix ?? "eco:presence:device:";
    this.userRoutesKeyPrefix = options.userRoutesKeyPrefix ?? "eco:presence:user-devices:";
  }

  async setSession(session: PresenceSession): Promise<void> {
    await this.redis.setex(this.sessionKey(session.sessionId), this.ttlSeconds, JSON.stringify(session));
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.redis.del(this.sessionKey(sessionId));
  }

  async getSession(sessionId: string): Promise<PresenceSession | undefined> {
    const value = await this.redis.get(this.sessionKey(sessionId));
    if (!value) {
      return undefined;
    }
    const parsed = JSON.parse(value) as unknown;
    return isPresenceSession(parsed) ? parsed : undefined;
  }

  async setDeviceRoute(route: DeviceRoute): Promise<void> {
    await this.redis.setex(this.routeKey(route.deviceId), this.ttlSeconds, JSON.stringify(route));
    await this.redis.sadd(this.userRoutesKey(route.userId), route.deviceId);
  }

  async deleteDeviceRoute(input: { deviceId: string; userId: string; sessionId: string }): Promise<void> {
    await this.redis.eval(
      `
      local route = redis.call("GET", KEYS[1])
      if not route then
        redis.call("SREM", KEYS[2], ARGV[2])
        return 0
      end
      local parsed = cjson.decode(route)
      if parsed["sessionId"] == ARGV[1] then
        redis.call("DEL", KEYS[1])
        redis.call("SREM", KEYS[2], ARGV[2])
        return 1
      end
      return 0
      `,
      2,
      this.routeKey(input.deviceId),
      this.userRoutesKey(input.userId),
      input.sessionId,
      input.deviceId,
    );
  }

  async getDeviceRoute(deviceId: string): Promise<DeviceRoute | undefined> {
    const value = await this.redis.get(this.routeKey(deviceId));
    if (!value) {
      return undefined;
    }
    const parsed = JSON.parse(value) as unknown;
    return isDeviceRoute(parsed) ? parsed : undefined;
  }

  async listDeviceRoutesForUser(userId: string): Promise<DeviceRoute[]> {
    const deviceIds = await this.redis.smembers(this.userRoutesKey(userId));
    const routes = await Promise.all(deviceIds.map((deviceId) => this.getDeviceRoute(deviceId)));
    return routes.filter((route): route is DeviceRoute => route !== undefined && route.userId === userId);
  }

  async close(): Promise<void> {
    await this.redis.quit?.();
    this.redis.disconnect?.();
  }

  private sessionKey(sessionId: string): string {
    return `${this.sessionKeyPrefix}${sessionId}`;
  }

  private routeKey(deviceId: string): string {
    return `${this.routeKeyPrefix}${deviceId}`;
  }

  private userRoutesKey(userId: string): string {
    return `${this.userRoutesKeyPrefix}${userId}`;
  }
}

export function buildRedisConnectionUrl(redisPassword?: string, redisUrl = ECO_SERVER_REDIS_URL): string {
  const password = redisPassword?.trim();
  if (!password) {
    return redisUrl;
  }
  const parsed = new URL(redisUrl);
  parsed.password = password;
  return parsed.toString();
}

export function createRedisPresenceStore(redisUrl: string, redisPassword?: string): RedisPresenceStore {
  const client = new Redis(buildRedisConnectionUrl(redisPassword, redisUrl)) as RedisLike;
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

function isDeviceRoute(value: unknown): value is DeviceRoute {
  if (!isPresenceSession(value)) {
    return false;
  }
  return typeof (value as DeviceRoute).instanceId === "string";
}
