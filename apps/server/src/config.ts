export interface ServerConfig {
  host: string;
  port: number;
  instanceId: string;
  mongoUri: string;
  mongoDatabase?: string;
  redisUrl: string;
  redisPassword?: string;
  tokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  pairingTtlSeconds: number;
  rpcTimeoutMs: number;
}

export function loadConfig(env: Record<string, string | undefined> = Bun.env): ServerConfig {
  const tokenSecret = env.ECO_SERVER_TOKEN_SECRET;
  if (!tokenSecret || tokenSecret.length < 32) {
    throw new Error("ECO_SERVER_TOKEN_SECRET must be set to at least 32 characters.");
  }

  return {
    host: env.ECO_SERVER_HOST ?? "127.0.0.1",
    port: parsePositiveInt(env.ECO_SERVER_PORT, 3128),
    instanceId: env.ECO_SERVER_INSTANCE_ID?.trim() || `srv_${crypto.randomUUID()}`,
    mongoUri: env.ECO_SERVER_MONGODB_URI ?? "mongodb://127.0.0.1:27017/eco-coding",
    ...(env.ECO_SERVER_MONGODB_DATABASE?.trim()
      ? { mongoDatabase: env.ECO_SERVER_MONGODB_DATABASE.trim() }
      : {}),
    redisUrl: env.ECO_SERVER_REDIS_URL ?? "redis://127.0.0.1:6379",
    ...(env.ECO_SERVER_REDIS_PASSWORD?.trim() ? { redisPassword: env.ECO_SERVER_REDIS_PASSWORD.trim() } : {}),
    tokenSecret,
    accessTokenTtlSeconds: parsePositiveInt(env.ECO_ACCESS_TOKEN_TTL_SECONDS, 15 * 60),
    refreshTokenTtlSeconds: parsePositiveInt(env.ECO_REFRESH_TOKEN_TTL_SECONDS, 60 * 60 * 24 * 60),
    pairingTtlSeconds: parsePositiveInt(env.ECO_PAIRING_TTL_SECONDS, 5 * 60),
    rpcTimeoutMs: parsePositiveInt(env.ECO_RPC_TIMEOUT_MS, 30_000),
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got ${value}`);
  }
  return parsed;
}
