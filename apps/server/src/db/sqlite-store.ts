import { Database } from "bun:sqlite";
import type { EcoDeviceCapability, EcoDeviceKind } from "@eco/shared";
import type {
  AuditLogInput,
  AuditLogRecord,
  DeviceBindingRecord,
  DeviceRecord,
  PairingSessionRecord,
  RefreshTokenRecord,
  UserRecord,
} from "../types";

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  password_salt: string;
  password_hash: string;
  password_iterations: number;
  created_at: string;
  disabled_at: string | null;
}

interface DeviceRow {
  id: string;
  user_id: string;
  kind: EcoDeviceKind;
  name: string;
  secret_hash: string;
  created_at: string;
  last_seen_at: string | null;
  disabled_at: string | null;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  device_id: string | null;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

interface PairingSessionRow {
  id: string;
  user_id: string;
  desktop_device_id: string;
  code_hash: string;
  expires_at: string;
  claimed_at: string | null;
  created_at: string;
}

interface DeviceBindingRow {
  id: string;
  user_id: string;
  desktop_device_id: string;
  mobile_device_id: string;
  capabilities_json: string;
  created_at: string;
  revoked_at: string | null;
}

interface AuditLogRow {
  id: string;
  user_id: string;
  action: string;
  status: AuditLogRecord["status"];
  actor_device_id: string | null;
  target_device_id: string | null;
  rpc_method: string | null;
  channel: string | null;
  error_code: number | null;
  error_message: string | null;
  metadata_json: string | null;
  created_at: string;
}

export interface SqliteStoreOptions {
  path?: string;
  database?: Database;
}

export class SqliteStore {
  readonly db: Database;

  constructor(options: SqliteStoreOptions = {}) {
    this.db = options.database ?? new Database(options.path ?? "eco-server.sqlite", { create: true });
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  createUser(input: {
    id: string;
    email: string;
    displayName: string | null;
    passwordSalt: string;
    passwordHash: string;
    passwordIterations: number;
    now: string;
  }): UserRecord {
    this.db
      .query(
        `INSERT INTO users (
          id, email, display_name, password_salt, password_hash, password_iterations, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.email.toLowerCase(),
        input.displayName,
        input.passwordSalt,
        input.passwordHash,
        input.passwordIterations,
        input.now,
      );
    const user = this.findUserById(input.id);
    if (!user) {
      throw new Error("Created user could not be loaded.");
    }
    return user;
  }

  findUserById(id: string): UserRecord | undefined {
    const row = this.db.query<UserRow, [string]>("SELECT * FROM users WHERE id = ?").get(id);
    return row ? mapUser(row) : undefined;
  }

  findUserByEmail(email: string): UserRecord | undefined {
    const row = this.db
      .query<UserRow, [string]>("SELECT * FROM users WHERE email = ?")
      .get(email.toLowerCase());
    return row ? mapUser(row) : undefined;
  }

  createDevice(input: {
    id: string;
    userId: string;
    kind: EcoDeviceKind;
    name: string;
    secretHash: string;
    now: string;
  }): DeviceRecord {
    this.db
      .query(
        `INSERT INTO devices (id, user_id, kind, name, secret_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.userId, input.kind, input.name, input.secretHash, input.now);
    const device = this.findDeviceById(input.id);
    if (!device) {
      throw new Error("Created device could not be loaded.");
    }
    return device;
  }

  findDeviceById(id: string): DeviceRecord | undefined {
    const row = this.db.query<DeviceRow, [string]>("SELECT * FROM devices WHERE id = ?").get(id);
    return row ? mapDevice(row) : undefined;
  }

  listDevicesForUser(userId: string, options: { includeDisabled?: boolean } = {}): DeviceRecord[] {
    const rows = options.includeDisabled
      ? this.db
          .query<DeviceRow, [string]>("SELECT * FROM devices WHERE user_id = ? ORDER BY created_at ASC")
          .all(userId)
      : this.db
          .query<DeviceRow, [string]>(
            "SELECT * FROM devices WHERE user_id = ? AND disabled_at IS NULL ORDER BY created_at ASC",
          )
          .all(userId);
    return rows.map(mapDevice);
  }

  touchDevice(id: string, now: string): void {
    this.db.query("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(now, id);
  }

  disableDevice(userId: string, deviceId: string, now: string): DeviceRecord | undefined {
    const result = this.db
      .query(
        `UPDATE devices
         SET disabled_at = COALESCE(disabled_at, ?)
         WHERE id = ?
           AND user_id = ?`,
      )
      .run(now, deviceId, userId);
    if (result.changes !== 1) {
      return undefined;
    }
    this.db
      .query("UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE device_id = ?")
      .run(now, deviceId);
    this.db
      .query(
        `UPDATE device_bindings
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE desktop_device_id = ?
            OR mobile_device_id = ?`,
      )
      .run(now, deviceId, deviceId);
    return this.findDeviceById(deviceId);
  }

  createRefreshToken(input: {
    id: string;
    userId: string;
    deviceId: string | null;
    tokenHash: string;
    expiresAt: string;
    now: string;
  }): RefreshTokenRecord {
    this.db
      .query(
        `INSERT INTO refresh_tokens (id, user_id, device_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.userId, input.deviceId, input.tokenHash, input.expiresAt, input.now);
    const token = this.findRefreshTokenByHash(input.tokenHash);
    if (!token) {
      throw new Error("Created refresh token could not be loaded.");
    }
    return token;
  }

  findRefreshTokenByHash(tokenHash: string): RefreshTokenRecord | undefined {
    const row = this.db
      .query<RefreshTokenRow, [string]>("SELECT * FROM refresh_tokens WHERE token_hash = ?")
      .get(tokenHash);
    return row ? mapRefreshToken(row) : undefined;
  }

  revokeRefreshToken(id: string, now: string): void {
    this.db.query("UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?").run(now, id);
  }

  revokeRefreshTokenByHash(tokenHash: string, now: string): RefreshTokenRecord | undefined {
    const result = this.db
      .query("UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ?")
      .run(now, tokenHash);
    if (result.changes !== 1) {
      return undefined;
    }
    return this.findRefreshTokenByHash(tokenHash);
  }

  createPairingSession(input: {
    id: string;
    userId: string;
    desktopDeviceId: string;
    codeHash: string;
    expiresAt: string;
    now: string;
  }): PairingSessionRecord {
    this.db
      .query(
        `INSERT INTO pairing_sessions (
          id, user_id, desktop_device_id, code_hash, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.userId, input.desktopDeviceId, input.codeHash, input.expiresAt, input.now);
    const session = this.findPairingSessionById(input.id);
    if (!session) {
      throw new Error("Created pairing session could not be loaded.");
    }
    return session;
  }

  findPairingSessionById(id: string): PairingSessionRecord | undefined {
    const row = this.db.query<PairingSessionRow, [string]>("SELECT * FROM pairing_sessions WHERE id = ?").get(id);
    return row ? mapPairingSession(row) : undefined;
  }

  claimPairingSessionByCodeHash(codeHash: string, now: string): PairingSessionRecord | undefined {
    const result = this.db
      .query(
        `UPDATE pairing_sessions
         SET claimed_at = ?
         WHERE code_hash = ?
           AND claimed_at IS NULL
           AND expires_at > ?`,
      )
      .run(now, codeHash, now);
    if (result.changes !== 1) {
      return undefined;
    }
    const row = this.db
      .query<PairingSessionRow, [string]>("SELECT * FROM pairing_sessions WHERE code_hash = ?")
      .get(codeHash);
    return row ? mapPairingSession(row) : undefined;
  }

  createDeviceBinding(input: {
    id: string;
    userId: string;
    desktopDeviceId: string;
    mobileDeviceId: string;
    capabilities: EcoDeviceCapability[];
    now: string;
  }): DeviceBindingRecord {
    this.db
      .query(
        `INSERT INTO device_bindings (
          id, user_id, desktop_device_id, mobile_device_id, capabilities_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, desktop_device_id, mobile_device_id)
        DO UPDATE SET capabilities_json = excluded.capabilities_json, revoked_at = NULL`,
      )
      .run(
        input.id,
        input.userId,
        input.desktopDeviceId,
        input.mobileDeviceId,
        JSON.stringify(input.capabilities),
        input.now,
      );
    const binding = this.findActiveBinding(input.userId, input.desktopDeviceId, input.mobileDeviceId);
    if (!binding) {
      throw new Error("Created device binding could not be loaded.");
    }
    return binding;
  }

  findActiveBinding(
    userId: string,
    desktopDeviceId: string,
    mobileDeviceId: string,
  ): DeviceBindingRecord | undefined {
    const row = this.db
      .query<DeviceBindingRow, [string, string, string]>(
        `SELECT * FROM device_bindings
         WHERE user_id = ?
           AND desktop_device_id = ?
           AND mobile_device_id = ?
           AND revoked_at IS NULL`,
      )
      .get(userId, desktopDeviceId, mobileDeviceId);
    return row ? mapDeviceBinding(row) : undefined;
  }

  listActiveBindingsForDesktop(userId: string, desktopDeviceId: string): DeviceBindingRecord[] {
    return this.db
      .query<DeviceBindingRow, [string, string]>(
        `SELECT * FROM device_bindings
         WHERE user_id = ?
           AND desktop_device_id = ?
           AND revoked_at IS NULL`,
      )
      .all(userId, desktopDeviceId)
      .map(mapDeviceBinding);
  }

  listBindingsForUser(userId: string, options: { includeRevoked?: boolean } = {}): DeviceBindingRecord[] {
    const rows = options.includeRevoked
      ? this.db
          .query<DeviceBindingRow, [string]>(
            "SELECT * FROM device_bindings WHERE user_id = ? ORDER BY created_at ASC",
          )
          .all(userId)
      : this.db
          .query<DeviceBindingRow, [string]>(
            "SELECT * FROM device_bindings WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at ASC",
          )
          .all(userId);
    return rows.map(mapDeviceBinding);
  }

  findBindingById(userId: string, bindingId: string): DeviceBindingRecord | undefined {
    const row = this.db
      .query<DeviceBindingRow, [string, string]>(
        "SELECT * FROM device_bindings WHERE user_id = ? AND id = ?",
      )
      .get(userId, bindingId);
    return row ? mapDeviceBinding(row) : undefined;
  }

  revokeBinding(userId: string, bindingId: string, now: string): DeviceBindingRecord | undefined {
    const result = this.db
      .query(
        `UPDATE device_bindings
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE user_id = ?
           AND id = ?`,
      )
      .run(now, userId, bindingId);
    if (result.changes !== 1) {
      return undefined;
    }
    return this.findBindingById(userId, bindingId);
  }

  createAuditLog(input: AuditLogInput & { id: string; now: string }): AuditLogRecord {
    this.db
      .query(
        `INSERT INTO audit_logs (
          id, user_id, action, status, actor_device_id, target_device_id, rpc_method,
          channel, error_code, error_message, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.userId,
        input.action,
        input.status,
        input.actorDeviceId ?? null,
        input.targetDeviceId ?? null,
        input.rpcMethod ?? null,
        input.channel ?? null,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.now,
      );
    const row = this.db.query<AuditLogRow, [string]>("SELECT * FROM audit_logs WHERE id = ?").get(input.id);
    if (!row) {
      throw new Error("Created audit log could not be loaded.");
    }
    return mapAuditLog(row);
  }

  listAuditLogs(options: { userId?: string; limit?: number; order?: "asc" | "desc" } = {}): AuditLogRecord[] {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    const order = options.order === "desc" ? "DESC" : "ASC";
    const rows = options.userId
      ? this.db
          .query<AuditLogRow, [string, number]>(
            `SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at ${order} LIMIT ?`,
          )
          .all(options.userId, limit)
      : this.db
          .query<AuditLogRow, [number]>(`SELECT * FROM audit_logs ORDER BY created_at ${order} LIMIT ?`)
          .all(limit);
    return rows.map(mapAuditLog);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_iterations INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        disabled_at TEXT
      );

      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('desktop', 'mobile')),
        name TEXT NOT NULL,
        secret_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT,
        disabled_at TEXT
      );

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT REFERENCES devices(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pairing_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        desktop_device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        claimed_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS device_bindings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        desktop_device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        mobile_device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        capabilities_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        UNIQUE(user_id, desktop_device_id, mobile_device_id)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        actor_device_id TEXT,
        target_device_id TEXT,
        rpc_method TEXT,
        channel TEXT,
        error_code INTEGER,
        error_message TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
      CREATE INDEX IF NOT EXISTS idx_bindings_desktop ON device_bindings(user_id, desktop_device_id);
      CREATE INDEX IF NOT EXISTS idx_pairing_code ON pairing_sessions(code_hash);
      CREATE INDEX IF NOT EXISTS idx_audit_user_created ON audit_logs(user_id, created_at);
    `);
  }
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordSalt: row.password_salt,
    passwordHash: row.password_hash,
    passwordIterations: row.password_iterations,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
  };
}

function mapDevice(row: DeviceRow): DeviceRecord {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    name: row.name,
    secretHash: row.secret_hash,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    disabledAt: row.disabled_at,
  };
}

function mapRefreshToken(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

function mapPairingSession(row: PairingSessionRow): PairingSessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    desktopDeviceId: row.desktop_device_id,
    codeHash: row.code_hash,
    expiresAt: row.expires_at,
    claimedAt: row.claimed_at,
    createdAt: row.created_at,
  };
}

function mapDeviceBinding(row: DeviceBindingRow): DeviceBindingRecord {
  return {
    id: row.id,
    userId: row.user_id,
    desktopDeviceId: row.desktop_device_id,
    mobileDeviceId: row.mobile_device_id,
    capabilities: parseCapabilities(row.capabilities_json),
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

function mapAuditLog(row: AuditLogRow): AuditLogRecord {
  return {
    id: row.id,
    userId: row.user_id,
    action: row.action,
    status: row.status,
    ...(row.actor_device_id ? { actorDeviceId: row.actor_device_id } : {}),
    ...(row.target_device_id ? { targetDeviceId: row.target_device_id } : {}),
    ...(row.rpc_method ? { rpcMethod: row.rpc_method } : {}),
    ...(row.channel ? { channel: row.channel } : {}),
    ...(row.error_code !== null ? { errorCode: row.error_code } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    ...(row.metadata_json ? { metadata: parseMetadata(row.metadata_json) } : {}),
    createdAt: row.created_at,
  };
}

function parseCapabilities(value: string): EcoDeviceCapability[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter(isDeviceCapability) : [];
}

function parseMetadata(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function isDeviceCapability(value: unknown): value is EcoDeviceCapability {
  return (
    value === "events:publish" ||
    value === "events:read" ||
    value === "rpc:receive" ||
    value === "rpc:invoke" ||
    value === "approval:decide" ||
    value === "device:pair" ||
    value === "device:admin"
  );
}
