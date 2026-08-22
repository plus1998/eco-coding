import { createRandomToken, sha256Hex } from "./crypto.ts";
import { HttpError } from "./http.ts";
import type { AdminClient } from "./supabase.ts";

export type DeviceKind = "desktop" | "mobile";

export interface DeviceRow {
  id: string;
  user_id: string;
  kind: DeviceKind;
  name: string;
  secret_hash: string;
  metadata: Record<string, unknown>;
  created_at: string;
  last_seen_at: string | null;
  disabled_at: string | null;
  vault_synced_at: string | null;
}

export interface PublicDevice {
  id: string;
  userId: string;
  kind: DeviceKind;
  name: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  lastSeenAt: string | null;
  disabledAt: string | null;
  vaultSyncedAt: string | null;
}

export const DEFAULT_BINDING_CAPABILITIES = ["events:read", "rpc:invoke", "approval:decide"] as const;

export function toPublicDevice(row: DeviceRow): PublicDevice {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    name: row.name,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    disabledAt: row.disabled_at,
    vaultSyncedAt: row.vault_synced_at,
  };
}

export function parseDeviceKind(value: unknown): DeviceKind {
  if (value === "desktop" || value === "mobile") {
    return value;
  }
  throw new HttpError(400, "kind must be desktop or mobile.", "invalid_request");
}

export async function registerDevice(
  admin: AdminClient,
  input: {
    sessionId: string;
    userId: string;
    kind: DeviceKind;
    name: string;
    metadata?: Record<string, unknown>;
  },
): Promise<{ device: PublicDevice; deviceSecret: string }> {
  const name = input.name.trim();
  if (!name) {
    throw new HttpError(400, "Device name is required.", "invalid_request");
  }

  const deviceSecret = createRandomToken(48);
  const secretHash = await sha256Hex(deviceSecret);

  const { data, error } = await admin.rpc("eco_register_device_session", {
    p_session_id: input.sessionId,
    p_user_id: input.userId,
    p_kind: input.kind,
    p_name: name,
    p_secret_hash: secretHash,
    p_metadata: input.metadata ?? {},
  });

  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    console.error("device session registration failed", error);
    throw new HttpError(500, "Failed to register device.", "register_failed");
  }

  return {
    device: toPublicDevice(row as DeviceRow),
    deviceSecret,
  };
}

export async function requireOwnedDevice(
  admin: AdminClient,
  input: {
    userId: string;
    deviceId: string;
    kind: DeviceKind;
    deviceSecret: string;
  },
): Promise<DeviceRow> {
  const { data, error } = await admin
    .from("devices")
    .select(
      "id, user_id, kind, name, secret_hash, metadata, created_at, last_seen_at, disabled_at, vault_synced_at",
    )
    .eq("id", input.deviceId)
    .maybeSingle();

  if (error) {
    console.error("devices lookup failed", error);
    throw new HttpError(500, "Failed to load device.", "device_lookup_failed");
  }

  const device = data as DeviceRow | null;
  if (!device || device.user_id !== input.userId || device.kind !== input.kind || device.disabled_at) {
    throw new HttpError(403, `${input.kind} device is not active.`, "device_inactive");
  }

  const secretHash = await sha256Hex(input.deviceSecret);
  if (secretHash !== device.secret_hash) {
    throw new HttpError(401, "Device credentials are invalid.", "invalid_device_secret");
  }

  return device;
}

export async function disableDevice(
  admin: AdminClient,
  input: {
    userId: string;
    deviceId: string;
  },
): Promise<PublicDevice> {
  const { data, error } = await admin.rpc("eco_disable_device_sessions", {
    p_user_id: input.userId,
    p_device_id: input.deviceId,
    p_disabled_at: new Date().toISOString(),
  });

  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    console.error("device disable and session revocation failed", error);
    throw new HttpError(500, "Failed to disable device.", "device_disable_failed");
  }

  return toPublicDevice(row as DeviceRow);
}
