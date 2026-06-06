import type Redis from "ioredis";
import type { SessionKey, SessionStore, SessionStoreEntry, SessionStoreListEntry } from "./session-store.js";

export type RedisSessionStoreOptions = {
  client: Redis;
  prefix?: string;
};

const SUBKEYS = "__subkeys";
const SESSIONS = "__sessions";

export class RedisSessionStore implements SessionStore {
  private readonly client: Redis;
  private readonly prefix: string;

  constructor(options: RedisSessionStoreOptions) {
    this.client = options.client;
    this.prefix = options.prefix ? `${options.prefix.replace(/:+$/, "")}:` : "";
  }

  private entryKey(key: SessionKey): string {
    const parts = [key.projectKey, key.sessionId];
    if (key.subpath) {
      parts.push(key.subpath);
    }
    return this.prefix + parts.join(":");
  }

  private subkeysKey(key: { projectKey: string; sessionId: string }): string {
    return `${this.prefix}${key.projectKey}:${key.sessionId}:${SUBKEYS}`;
  }

  private sessionsKey(projectKey: string): string {
    return `${this.prefix}${projectKey}:${SESSIONS}`;
  }

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    const pipe = this.client.multi();
    pipe.rpush(this.entryKey(key), ...entries.map((entry) => JSON.stringify(entry)));
    if (key.subpath) {
      pipe.sadd(this.subkeysKey(key), key.subpath);
    } else {
      pipe.zadd(this.sessionsKey(key.projectKey), Date.now(), key.sessionId);
    }
    await pipe.exec();
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const raw = await this.client.lrange(this.entryKey(key), 0, -1);
    if (raw.length === 0) {
      return null;
    }
    const out: SessionStoreEntry[] = [];
    for (const line of raw) {
      try {
        out.push(JSON.parse(line) as SessionStoreEntry);
      } catch {
        // Skip malformed entries.
      }
    }
    return out.length > 0 ? out : null;
  }

  async listSessions(projectKey: string): Promise<SessionStoreListEntry[]> {
    const flat = await this.client.zrange(this.sessionsKey(projectKey), 0, -1, "WITHSCORES");
    const result: SessionStoreListEntry[] = [];
    for (let index = 0; index < flat.length; index += 2) {
      const sessionId = flat[index];
      const mtime = flat[index + 1];
      if (sessionId && mtime) {
        result.push({ sessionId, mtime: Number(mtime) });
      }
    }
    return result;
  }

  async delete(key: SessionKey): Promise<void> {
    if (key.subpath !== undefined) {
      await this.client
        .multi()
        .del(this.entryKey(key))
        .srem(this.subkeysKey(key), key.subpath)
        .exec();
      return;
    }

    const subkeysKey = this.subkeysKey(key);
    const subpaths = await this.client.smembers(subkeysKey);
    const toDelete = [
      this.entryKey(key),
      subkeysKey,
      ...subpaths.map((subpath) => this.entryKey({ ...key, subpath })),
    ];
    await this.client
      .multi()
      .del(...toDelete)
      .zrem(this.sessionsKey(key.projectKey), key.sessionId)
      .exec();
  }

  async listSubkeys(key: { projectKey: string; sessionId: string }): Promise<string[]> {
    return this.client.smembers(this.subkeysKey(key));
  }
}

export interface RedisSessionStoreConnection {
  store: RedisSessionStore;
  close: () => Promise<void>;
}

export async function createRedisSessionStore(config: {
  url: string;
  password?: string;
  keyPrefix?: string;
}): Promise<RedisSessionStoreConnection> {
  const { default: IORedis } = await import("ioredis");
  const client = new IORedis(config.url, {
    ...(config.password ? { password: config.password } : {}),
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
  await client.connect();
  await client.ping();
  return {
    store: new RedisSessionStore({
      client,
      prefix: config.keyPrefix?.trim() || "eco-sessions",
    }),
    close: async () => {
      await client.quit();
    },
  };
}

export async function testRedisConnection(config: {
  url: string;
  password?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { close } = await createRedisSessionStore({
      url: config.url,
      keyPrefix: "eco-sessions-test",
      ...(config.password ? { password: config.password } : {}),
    });
    await close();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
