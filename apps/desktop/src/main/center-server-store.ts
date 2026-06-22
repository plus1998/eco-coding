import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import {
  type CenterServerConnectionStatus,
  type CenterServerSettingsInput,
  type CenterServerSettingsSnapshot,
  type CenterServerSettingsView,
  normalizeCenterServerHttpUrl,
  previewCenterServerSecret,
  validateCenterServerSettingsInput,
} from "../shared/center-server";

interface CenterServerConfigRow {
  enabled: number;
  server_url: string;
  device_id: string;
  device_name: string;
  device_secret: string;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  last_connected_at: string;
  last_error: string;
  updated_at: string;
}

export interface CenterServerSettingsSecret extends CenterServerSettingsView {
  deviceSecret: string;
  accessToken: string;
  refreshToken: string;
}

export interface CenterServerSecretCodec {
  encode(value: string): string;
  decode(value: string): string;
}

export interface ElectronSafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface CenterServerStoreOptions {
  secretCodec?: CenterServerSecretCodec;
}

const DEFAULT_DEVICE_NAME = "Eco Desktop";
const SAFE_STORAGE_SECRET_PREFIX = "safe:v1:";

export async function createCenterServerStore(
  dbPath: string,
  options: CenterServerStoreOptions = {},
): Promise<CenterServerStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new CenterServerStore(new sqlite.DatabaseSync(dbPath), options);
  store.initialize();
  return store;
}

export class CenterServerStore {
  private readonly secretCodec: CenterServerSecretCodec | undefined;

  constructor(
    private readonly db: DatabaseSyncType,
    options: CenterServerStoreOptions = {},
  ) {
    this.secretCodec = options.secretCodec;
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS center_server_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        server_url TEXT NOT NULL DEFAULT '',
        device_id TEXT NOT NULL DEFAULT '',
        device_name TEXT NOT NULL DEFAULT '${DEFAULT_DEVICE_NAME}',
        device_secret TEXT NOT NULL DEFAULT '',
        access_token TEXT NOT NULL DEFAULT '',
        refresh_token TEXT NOT NULL DEFAULT '',
        access_token_expires_at TEXT NOT NULL DEFAULT '',
        last_connected_at TEXT NOT NULL DEFAULT '',
        last_error TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
    `);

    const existing = this.getRow();
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO center_server_config (
            id, enabled, server_url, device_id, device_name, device_secret, access_token,
            refresh_token, access_token_expires_at, last_connected_at, last_error, updated_at
          ) VALUES (1, 0, '', '', ?, '', '', '', '', '', '', ?)`,
        )
        .run(DEFAULT_DEVICE_NAME, new Date().toISOString());
    }
  }

  getSettings(
    status: CenterServerConnectionStatus = { state: "disconnected" },
  ): CenterServerSettingsSnapshot {
    return {
      settings: rowToView(
        this.getRow() ?? fail("Center server config was not initialized."),
        this.secretCodec,
      ),
      status,
    };
  }

  getSettingsWithSecrets(): CenterServerSettingsSecret {
    const row = this.getRow() ?? fail("Center server config was not initialized.");
    return {
      ...rowToView(row, this.secretCodec),
      deviceSecret: decodeSecret(row.device_secret, this.secretCodec),
      accessToken: decodeSecret(row.access_token, this.secretCodec),
      refreshToken: decodeSecret(row.refresh_token, this.secretCodec),
    };
  }

  saveSettings(input: CenterServerSettingsInput): CenterServerSettingsView {
    validateCenterServerSettingsInput(input);
    const existing = this.getRow() ?? fail("Center server config was not initialized.");
    const serverUrl = input.serverUrl.trim() ? normalizeCenterServerHttpUrl(input.serverUrl) : "";
    const deviceSecret =
      input.deviceSecret && input.deviceSecret.length > 0
        ? encodeSecret(input.deviceSecret, this.secretCodec)
        : existing.device_secret;
    const refreshToken =
      input.refreshToken && input.refreshToken.length > 0
        ? encodeSecret(input.refreshToken, this.secretCodec)
        : existing.refresh_token;
    const accessToken =
      input.accessToken !== undefined
        ? encodeSecret(input.accessToken, this.secretCodec)
        : existing.access_token;
    const accessTokenExpiresAt = input.accessTokenExpiresAt ?? existing.access_token_expires_at;

    this.db
      .prepare(
        `UPDATE center_server_config
         SET enabled = ?, server_url = ?, device_id = ?, device_name = ?, device_secret = ?,
             access_token = ?, refresh_token = ?, access_token_expires_at = ?, updated_at = ?
         WHERE id = 1`,
      )
      .run(
        input.enabled ? 1 : 0,
        serverUrl,
        input.deviceId?.trim() ?? existing.device_id,
        input.deviceName?.trim() || existing.device_name || DEFAULT_DEVICE_NAME,
        deviceSecret,
        accessToken,
        refreshToken,
        accessTokenExpiresAt,
        new Date().toISOString(),
      );

    return rowToView(this.getRow() ?? fail("Center server config was not saved."), this.secretCodec);
  }

  saveTokens(input: {
    accessToken: string;
    refreshToken?: string;
    accessTokenExpiresAt: string;
  }): CenterServerSettingsView {
    const existing = this.getRow() ?? fail("Center server config was not initialized.");
    this.db
      .prepare(
        `UPDATE center_server_config
         SET access_token = ?, refresh_token = ?, access_token_expires_at = ?, updated_at = ?
         WHERE id = 1`,
      )
      .run(
        encodeSecret(input.accessToken, this.secretCodec),
        input.refreshToken ? encodeSecret(input.refreshToken, this.secretCodec) : existing.refresh_token,
        input.accessTokenExpiresAt,
        new Date().toISOString(),
      );
    return rowToView(this.getRow() ?? fail("Center server tokens were not saved."), this.secretCodec);
  }

  markConnected(connectedAt: string): void {
    this.db
      .prepare(
        `UPDATE center_server_config
         SET last_connected_at = ?, last_error = '', updated_at = ?
         WHERE id = 1`,
      )
      .run(connectedAt, new Date().toISOString());
  }

  markError(message: string): void {
    this.db
      .prepare(
        `UPDATE center_server_config
         SET last_error = ?, updated_at = ?
         WHERE id = 1`,
      )
      .run(message, new Date().toISOString());
  }

  clearRefreshToken(): void {
    this.db
      .prepare(
        `UPDATE center_server_config
         SET refresh_token = '', access_token = '', access_token_expires_at = '', updated_at = ?
         WHERE id = 1`,
      )
      .run(new Date().toISOString());
  }

  clearDeviceCredentials(): void {
    this.db
      .prepare(
        `UPDATE center_server_config
         SET device_id = '', device_secret = '', refresh_token = '', access_token = '',
             access_token_expires_at = '', last_error = '', updated_at = ?
         WHERE id = 1`,
      )
      .run(new Date().toISOString());
  }

  private getRow(): CenterServerConfigRow | undefined {
    return this.db
      .prepare(
        `SELECT enabled, server_url, device_id, device_name, device_secret, access_token,
                refresh_token, access_token_expires_at, last_connected_at, last_error, updated_at
         FROM center_server_config
         WHERE id = 1`,
      )
      .get() as CenterServerConfigRow | undefined;
  }
}

export function createElectronSafeStorageCenterServerSecretCodec(
  safeStorage: ElectronSafeStorageLike,
): CenterServerSecretCodec | undefined {
  if (!safeStorage.isEncryptionAvailable()) {
    return undefined;
  }
  return {
    encode(value) {
      if (!value) {
        return "";
      }
      return `${SAFE_STORAGE_SECRET_PREFIX}${safeStorage.encryptString(value).toString("base64")}`;
    },
    decode(value) {
      if (!value?.startsWith(SAFE_STORAGE_SECRET_PREFIX)) {
        return value;
      }
      return safeStorage.decryptString(Buffer.from(value.slice(SAFE_STORAGE_SECRET_PREFIX.length), "base64"));
    },
  };
}

function rowToView(
  row: CenterServerConfigRow,
  secretCodec: CenterServerSecretCodec | undefined,
): CenterServerSettingsView {
  const deviceSecret = decodeSecret(row.device_secret, secretCodec);
  const view: CenterServerSettingsView = {
    enabled: row.enabled === 1,
    serverUrl: row.server_url,
    deviceName: row.device_name || DEFAULT_DEVICE_NAME,
    hasDeviceSecret: deviceSecret.length > 0,
    hasRefreshToken: decodeSecret(row.refresh_token, secretCodec).length > 0,
  };
  if (row.device_id) {
    view.deviceId = row.device_id;
  }
  const secretPreview = previewCenterServerSecret(deviceSecret);
  if (secretPreview) {
    view.deviceSecretPreview = secretPreview;
  }
  if (row.access_token_expires_at) {
    view.accessTokenExpiresAt = row.access_token_expires_at;
  }
  if (row.last_connected_at) {
    view.lastConnectedAt = row.last_connected_at;
  }
  if (row.last_error) {
    view.lastError = row.last_error;
  }
  return view;
}

function encodeSecret(value: string, secretCodec: CenterServerSecretCodec | undefined): string {
  if (!value) {
    return "";
  }
  return secretCodec?.encode(value) ?? value;
}

function decodeSecret(value: string, secretCodec: CenterServerSecretCodec | undefined): string {
  if (!value) {
    return "";
  }
  return secretCodec?.decode(value) ?? value;
}

function fail(message: string): never {
  throw new Error(message);
}
