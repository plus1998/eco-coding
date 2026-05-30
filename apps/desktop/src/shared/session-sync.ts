export interface SessionSyncSettingsView {
  redisEnabled: boolean;
  redisUrl: string;
  keyPrefix: string;
  hasRedisPassword: boolean;
  redisPasswordPreview?: string;
}

export interface SessionSyncSettingsInput {
  redisEnabled: boolean;
  redisUrl: string;
  /** Empty string keeps the stored password. */
  redisPassword?: string;
  keyPrefix: string;
}

export interface SessionSyncSettingsSnapshot {
  settings: SessionSyncSettingsView;
}

export interface SessionSyncTestConnectionRequest {
  redisUrl: string;
  redisPassword?: string;
}

export interface SessionSyncTestConnectionResult {
  ok: boolean;
  error?: string;
}

export function validateSessionSyncInput(input: SessionSyncSettingsInput): void {
  if (!input.keyPrefix.trim()) {
    throw new Error("Key prefix is required.");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(input.keyPrefix.trim())) {
    throw new Error("Key prefix may only contain letters, numbers, underscores, and dashes.");
  }
  if (input.redisEnabled && !input.redisUrl.trim()) {
    throw new Error("Redis URL is required when remote sync is enabled.");
  }
}

export function previewSecret(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.length <= 4) {
    return "••••";
  }
  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}
