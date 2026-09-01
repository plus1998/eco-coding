export type SshAuthType = "password" | "key";
export type SshKeySource = "path" | "stored";

export interface SshBookmarkPublic {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  keySource?: SshKeySource;
  keyPath?: string;
  extraArgs?: string;
  order: number;
}

export interface SshBookmarkView extends SshBookmarkPublic {
  hasPassword: boolean;
  hasStoredKey: boolean;
}

export interface SshBookmarkListSnapshot {
  bookmarks: SshBookmarkPublic[];
}

export interface SshBookmarkSaveInput {
  id?: string;
  name: string;
  host: string;
  port?: number;
  username: string;
  authType: SshAuthType;
  keySource?: SshKeySource;
  keyPath?: string;
  /** Empty/undefined on edit means keep existing password. */
  password?: string;
  /** Empty/undefined on edit means keep existing stored key. */
  storedKey?: string;
  extraArgs?: string;
}

export interface SshBookmarkConnectResult {
  sessionId: string;
  label: string;
  passwordAutoInject?: boolean;
}

export const SSH_DEFAULT_PORT = 22;
export const SSH_MAX_NAME_LENGTH = 80;
export const SSH_MAX_HOST_LENGTH = 253;
export const SSH_MAX_USERNAME_LENGTH = 64;
export const SSH_MAX_EXTRA_ARGS_LENGTH = 500;
export const SSH_MAX_KEY_PATH_LENGTH = 1024;

export function sshBookmarkSecretPasswordKey(bookmarkId: string): string {
  return `ssh_password:${bookmarkId}`;
}

export function sshBookmarkSecretKeyKey(bookmarkId: string): string {
  return `ssh_key:${bookmarkId}`;
}

export function defaultSshBookmarkListSnapshot(): SshBookmarkListSnapshot {
  return { bookmarks: [] };
}

function normalizeId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const id = value.trim();
  if (!id || id.length > 128) {
    return undefined;
  }
  return id;
}

function normalizeName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const name = value.trim();
  if (!name || name.length > SSH_MAX_NAME_LENGTH) {
    return undefined;
  }
  return name;
}

function normalizeHost(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const host = value.trim();
  if (!host || host.length > SSH_MAX_HOST_LENGTH) {
    return undefined;
  }
  return host;
}

function normalizeUsername(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const username = value.trim();
  if (!username || username.length > SSH_MAX_USERNAME_LENGTH) {
    return undefined;
  }
  return username;
}

function normalizePort(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const port = Math.floor(value);
    if (port >= 1 && port <= 65535) {
      return port;
    }
  }
  return SSH_DEFAULT_PORT;
}

function normalizeAuthType(value: unknown): SshAuthType | undefined {
  if (value === "password" || value === "key") {
    return value;
  }
  return undefined;
}

function normalizeKeySource(value: unknown): SshKeySource | undefined {
  if (value === "path" || value === "stored") {
    return value;
  }
  return undefined;
}

function normalizeKeyPath(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const keyPath = value.trim();
  if (!keyPath || keyPath.length > SSH_MAX_KEY_PATH_LENGTH) {
    return undefined;
  }
  return keyPath;
}

function normalizeExtraArgs(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const extraArgs = value.trim();
  if (!extraArgs) {
    return undefined;
  }
  if (extraArgs.length > SSH_MAX_EXTRA_ARGS_LENGTH) {
    return undefined;
  }
  return extraArgs;
}

export function normalizeSshBookmarkPublic(value: unknown, fallbackOrder: number): SshBookmarkPublic | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const id = normalizeId(record.id);
  const name = normalizeName(record.name);
  const host = normalizeHost(record.host);
  const username = normalizeUsername(record.username);
  const authType = normalizeAuthType(record.authType);
  if (!id || !name || !host || !username || !authType) {
    return undefined;
  }
  const port = normalizePort(record.port);
  const order =
    typeof record.order === "number" && Number.isFinite(record.order)
      ? Math.floor(record.order)
      : fallbackOrder;
  if (authType === "key") {
    const keySource = normalizeKeySource(record.keySource);
    if (!keySource) {
      return undefined;
    }
    const extraArgs = normalizeExtraArgs(record.extraArgs);
    if (keySource === "path") {
      const keyPath = normalizeKeyPath(record.keyPath);
      if (!keyPath) {
        return undefined;
      }
      return {
        id,
        name,
        host,
        port,
        username,
        authType,
        keySource,
        keyPath,
        ...(extraArgs ? { extraArgs } : {}),
        order,
      };
    }
    return {
      id,
      name,
      host,
      port,
      username,
      authType,
      keySource: "stored",
      ...(extraArgs ? { extraArgs } : {}),
      order,
    };
  }
  const extraArgs = normalizeExtraArgs(record.extraArgs);
  return {
    id,
    name,
    host,
    port,
    username,
    authType,
    ...(extraArgs ? { extraArgs } : {}),
    order,
  };
}

export function normalizeSshBookmarkListSnapshot(value: unknown): SshBookmarkListSnapshot {
  if (!value || typeof value !== "object") {
    return defaultSshBookmarkListSnapshot();
  }
  const record = value as Record<string, unknown>;
  const rawBookmarks = Array.isArray(record.bookmarks) ? record.bookmarks : [];
  const seen = new Set<string>();
  const bookmarks: SshBookmarkPublic[] = [];
  for (let i = 0; i < rawBookmarks.length; i += 1) {
    const item = normalizeSshBookmarkPublic(rawBookmarks[i], i);
    if (!item || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    bookmarks.push(item);
  }
  bookmarks.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return { bookmarks };
}

export function isSshBookmarkListSnapshot(value: unknown): value is SshBookmarkListSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.bookmarks)) {
    return false;
  }
  for (const entry of record.bookmarks) {
    if (!normalizeSshBookmarkPublic(entry, 0)) {
      return false;
    }
  }
  return true;
}

export function sshBookmarkEndpointLabel(bookmark: Pick<SshBookmarkPublic, "username" | "host" | "port">): string {
  const portSuffix = bookmark.port === SSH_DEFAULT_PORT ? "" : `:${bookmark.port}`;
  return `${bookmark.username}@${bookmark.host}${portSuffix}`;
}

export type SshBookmarkValidationReason =
  | "invalid_name"
  | "invalid_host"
  | "invalid_username"
  | "invalid_port"
  | "invalid_auth"
  | "invalid_key_path"
  | "missing_password"
  | "missing_stored_key"
  | "duplicate_name";

export function validateSshBookmarkSaveInput(
  input: SshBookmarkSaveInput,
  existing: SshBookmarkListSnapshot,
  isEdit: boolean,
  hasExistingPassword: boolean,
  hasExistingStoredKey: boolean,
): { ok: true } | { ok: false; reason: SshBookmarkValidationReason } {
  const name = normalizeName(input.name);
  const host = normalizeHost(input.host);
  const username = normalizeUsername(input.username);
  const authType = normalizeAuthType(input.authType);
  if (!name) {
    return { ok: false, reason: "invalid_name" };
  }
  if (!host) {
    return { ok: false, reason: "invalid_host" };
  }
  if (!username) {
    return { ok: false, reason: "invalid_username" };
  }
  if (input.port !== undefined && normalizePort(input.port) !== input.port) {
    return { ok: false, reason: "invalid_port" };
  }
  if (!authType) {
    return { ok: false, reason: "invalid_auth" };
  }
  const snapshot = normalizeSshBookmarkListSnapshot(existing);
  const duplicate = snapshot.bookmarks.some(
    (item) => item.name.toLowerCase() === name.toLowerCase() && item.id !== input.id?.trim(),
  );
  if (duplicate) {
    return { ok: false, reason: "duplicate_name" };
  }
  if (authType === "password") {
    const password = input.password?.trim();
    if (!password && !(isEdit && hasExistingPassword)) {
      return { ok: false, reason: "missing_password" };
    }
    return { ok: true };
  }
  const keySource = normalizeKeySource(input.keySource);
  if (!keySource) {
    return { ok: false, reason: "invalid_auth" };
  }
  if (keySource === "path") {
    if (!normalizeKeyPath(input.keyPath)) {
      return { ok: false, reason: "invalid_key_path" };
    }
    return { ok: true };
  }
  const storedKey = input.storedKey?.trim();
  if (!storedKey && !(isEdit && hasExistingStoredKey)) {
    return { ok: false, reason: "missing_stored_key" };
  }
  return { ok: true };
}
