/**
 * Vault claim: transfer vault_key from a device that already synced secrets (Track E).
 *
 * Flow (Apple-like trust request — peer need not be online at request time):
 * 1. Requester (no vault_key) creates vault_claims row + keeps claim keypair locally
 * 2. Any later-online approver (has vault_key) lists pending claims, begins approve → 6-digit code
 * 3. Requester enters code → broadcasts on eco:vault:{claimId}
 * 4. Approver verifies hash, wraps vault_key (ECDH), broadcasts + writes DB
 * 5. Requester unwraps, stores vault_key, marks claim consumed + vault_synced_at
 *
 * No recovery codes. Creating a claim requires that some other device already has
 * vault_synced_at (not that it is online right now).
 */
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import {
  buildEcoVaultTopic,
  generateVaultClaimCode,
  generateVaultClaimKeyPair,
  hashVaultClaimCode,
  isWrappedVaultKey,
  normalizeVaultClaimCode,
  unwrapVaultKeyFromClaim,
  verifyVaultClaimCode,
  wrapVaultKeyForClaim,
  type WrappedVaultKey,
} from "@eco/shared";
import { listVaultSyncedDeviceIds } from "./supabase-settings-sync";

/** Pending claim lifetime — long enough for the peer device to be opened later. */
export const VAULT_CLAIM_TTL_MS = 24 * 60 * 60_000;
export const VAULT_CLAIM_BROADCAST_EVENT = "eco-vault";
/** @deprecated Use VAULT_NO_SYNCED_DEVICE_CODE — online-at-request is no longer required. */
export const VAULT_NO_SYNCED_PEER_CODE = "vault_no_synced_device_online";
/** No other device has ever vault-synced (first device must sync locally, not claim). */
export const VAULT_NO_SYNCED_DEVICE_CODE = "vault_no_synced_device";
/** Wrong 6-digit codes before the claim is cancelled (also enforced by DB trigger). */
export const VAULT_CLAIM_MAX_ATTEMPTS = 5;
export const VAULT_CLAIM_LOCKED_CODE = "vault_claim_locked";

export class VaultClaimError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "VaultClaimError";
    this.code = code;
  }
}

export interface VaultClaimRow {
  id: string;
  user_id: string;
  requester_device_id: string;
  approver_device_id: string | null;
  code_hash: string | null;
  requester_public_key: string | null;
  wrapped_vault_key: string | null;
  wrap_nonce: string | null;
  status: "pending" | "approved" | "consumed" | "expired" | "cancelled";
  attempt_count: number;
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
}

export interface VaultClaimView {
  id: string;
  requesterDeviceId: string;
  status: VaultClaimRow["status"];
  expiresAt: string;
  createdAt: string;
  approverDeviceId: string | null;
}

type VaultBroadcast =
  | { type: "code_submitted"; code: string; deviceId: string }
  | { type: "wrapped_key"; wrapped: WrappedVaultKey; approverDeviceId: string }
  | { type: "reject"; message: string; code?: string };

export function toVaultClaimView(row: VaultClaimRow): VaultClaimView {
  return {
    id: row.id,
    requesterDeviceId: row.requester_device_id,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    approverDeviceId: row.approver_device_id,
  };
}

export async function countOnlineVaultSyncedPeers(input: {
  client: SupabaseClient;
  selfDeviceId: string;
  onlineDeviceIds: ReadonlySet<string>;
}): Promise<number> {
  const syncedIds = await listVaultSyncedDeviceIds(input.client);
  return syncedIds.filter(
    (id) => id !== input.selfDeviceId && input.onlineDeviceIds.has(id),
  ).length;
}

/** True when another device (not self) has vault_synced_at — may be offline. */
export async function hasOtherVaultSyncedDevice(input: {
  client: SupabaseClient;
  selfDeviceId: string;
}): Promise<boolean> {
  const syncedIds = await listVaultSyncedDeviceIds(input.client);
  return syncedIds.some((id) => id !== input.selfDeviceId);
}

export async function createVaultClaim(input: {
  client: SupabaseClient;
  userId: string;
  requesterDeviceId: string;
  /** @deprecated Ignored — claims no longer require an online peer at create time. */
  onlineDeviceIds?: ReadonlySet<string>;
  now?: () => Date;
}): Promise<{ claim: VaultClaimView; requesterPrivateKey: string }> {
  const now = input.now ?? (() => new Date());
  const hasPeer = await hasOtherVaultSyncedDevice({
    client: input.client,
    selfDeviceId: input.requesterDeviceId,
  });
  if (!hasPeer) {
    throw new VaultClaimError(
      "No other device has synced a vault key yet. On a device that already has your API keys, sign in and sync once, then request authorization from this device.",
      VAULT_NO_SYNCED_DEVICE_CODE,
    );
  }

  // Replace prior pending claims from this requester so only one wait is active.
  await input.client
    .from("vault_claims")
    .update({
      status: "cancelled",
      resolved_at: now().toISOString(),
    })
    .eq("requester_device_id", input.requesterDeviceId)
    .eq("status", "pending");

  const keyPair = await generateVaultClaimKeyPair();
  const expiresAt = new Date(now().getTime() + VAULT_CLAIM_TTL_MS).toISOString();
  const { data, error } = await input.client
    .from("vault_claims")
    .insert({
      user_id: input.userId,
      requester_device_id: input.requesterDeviceId,
      requester_public_key: keyPair.publicKey,
      status: "pending",
      expires_at: expiresAt,
    })
    .select(
      "id, user_id, requester_device_id, approver_device_id, code_hash, requester_public_key, wrapped_vault_key, wrap_nonce, status, attempt_count, expires_at, created_at, resolved_at",
    )
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create vault claim.");
  }
  return {
    claim: toVaultClaimView(data as VaultClaimRow),
    requesterPrivateKey: keyPair.privateKey,
  };
}

export async function listPendingVaultClaims(
  client: SupabaseClient,
  now = () => new Date(),
): Promise<VaultClaimView[]> {
  const { data, error } = await client
    .from("vault_claims")
    .select(
      "id, user_id, requester_device_id, approver_device_id, code_hash, requester_public_key, wrapped_vault_key, wrap_nonce, status, attempt_count, expires_at, created_at, resolved_at",
    )
    .eq("status", "pending")
    .gt("expires_at", now().toISOString())
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => toVaultClaimView(row as VaultClaimRow));
}

export async function beginApproveVaultClaim(input: {
  client: SupabaseClient;
  claimId: string;
  approverDeviceId: string;
}): Promise<{ claim: VaultClaimView; code: string }> {
  const claim = await loadClaim(input.client, input.claimId);
  assertClaimPending(claim);
  if (!claim.requester_public_key) {
    throw new VaultClaimError("Claim is missing requester public key.", "vault_claim_invalid");
  }

  const code = generateVaultClaimCode();
  const codeHash = await hashVaultClaimCode(code);
  const { data, error } = await input.client
    .from("vault_claims")
    .update({
      code_hash: codeHash,
      approver_device_id: input.approverDeviceId,
    })
    .eq("id", input.claimId)
    .eq("status", "pending")
    .select(
      "id, user_id, requester_device_id, approver_device_id, code_hash, requester_public_key, wrapped_vault_key, wrap_nonce, status, attempt_count, expires_at, created_at, resolved_at",
    )
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to start vault claim approval.");
  }
  return { claim: toVaultClaimView(data as VaultClaimRow), code };
}

export interface VaultClaimApproverSession {
  claimId: string;
  code: string;
  stop: () => Promise<void>;
}

/**
 * Approver: listen on eco:vault:{claimId} for the requester's 6-digit code,
 * then wrap and transfer vault_key.
 */
export async function startVaultClaimApproverSession(input: {
  client: SupabaseClient;
  claimId: string;
  approverDeviceId: string;
  vaultKey: string;
  log?: (message: string) => void;
}): Promise<VaultClaimApproverSession> {
  const claim = await loadClaim(input.client, input.claimId);
  assertClaimPending(claim);
  if (!claim.code_hash || !claim.requester_public_key) {
    throw new VaultClaimError(
      "Call beginApproveVaultClaim before starting the approver session.",
      "vault_claim_not_ready",
    );
  }

  const topic = buildEcoVaultTopic(input.claimId);
  const channel = input.client.channel(topic, { config: { private: true } });
  let stopped = false;

  const onBroadcast = async (raw: unknown) => {
    if (stopped) {
      return;
    }
    const message = parseVaultBroadcast(raw);
    if (!message || message.type !== "code_submitted") {
      return;
    }
    try {
      const latest = await loadClaim(input.client, input.claimId);
      assertClaimPending(latest);
      if (!latest.code_hash || !latest.requester_public_key) {
        throw new VaultClaimError("Claim is incomplete.", "vault_claim_invalid");
      }
      const ok = await verifyVaultClaimCode(message.code, latest.code_hash);
      if (!ok) {
        const failed = await recordFailedVaultClaimAttempt(input.client, latest);
        if (failed.locked) {
          await sendVaultBroadcast(channel, {
            type: "reject",
            message: "Too many invalid claim codes. Request a new vault claim.",
            code: VAULT_CLAIM_LOCKED_CODE,
          });
          return;
        }
        await sendVaultBroadcast(channel, {
          type: "reject",
          message: "Invalid claim code.",
          code: "vault_claim_bad_code",
        });
        return;
      }

      const wrapped = await wrapVaultKeyForClaim(input.vaultKey, latest.requester_public_key);
      const resolvedAt = new Date().toISOString();
      const { error } = await input.client
        .from("vault_claims")
        .update({
          status: "approved",
          wrapped_vault_key: JSON.stringify(wrapped),
          wrap_nonce: wrapped.nonce,
          approver_device_id: input.approverDeviceId,
          resolved_at: resolvedAt,
        })
        .eq("id", input.claimId)
        .eq("status", "pending");
      if (error) {
        throw new Error(error.message);
      }

      await sendVaultBroadcast(channel, {
        type: "wrapped_key",
        wrapped,
        approverDeviceId: input.approverDeviceId,
      });
    } catch (error) {
      input.log?.(`[eco] vault claim approve failed: ${errorMessage(error)}\n`);
      await sendVaultBroadcast(channel, {
        type: "reject",
        message: errorMessage(error),
        code: error instanceof VaultClaimError ? error.code : "vault_claim_approve_failed",
      }).catch(() => {});
    }
  };

  await new Promise<void>((resolve, reject) => {
    channel.on("broadcast", { event: VAULT_CLAIM_BROADCAST_EVENT }, (payload) => {
      void onBroadcast(payload);
    });
    channel.subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        resolve();
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reject(err ?? new Error(`Vault claim channel failed: ${status}`));
      }
    });
  });

  return {
    claimId: input.claimId,
    code: "", // caller already has code from beginApprove
    stop: async () => {
      stopped = true;
      await input.client.removeChannel(channel);
    },
  };
}

export async function submitVaultClaimCodeAndReceiveKey(input: {
  client: SupabaseClient;
  claimId: string;
  requesterDeviceId: string;
  requesterPrivateKey: string;
  code: string;
  timeoutMs?: number;
}): Promise<string> {
  const normalized = normalizeVaultClaimCode(input.code);
  if (!normalized) {
    throw new VaultClaimError("Enter a valid 6-digit claim code.", "vault_claim_bad_code");
  }

  const claim = await loadClaim(input.client, input.claimId);
  assertClaimPending(claim);
  if (claim.requester_device_id !== input.requesterDeviceId) {
    throw new VaultClaimError("This claim belongs to another device.", "vault_claim_wrong_device");
  }
  if (!claim.code_hash) {
    throw new VaultClaimError(
      "Waiting for an online synced device to start approval and show a code.",
      "vault_claim_awaiting_approver",
    );
  }

  const topic = buildEcoVaultTopic(input.claimId);
  const channel = input.client.channel(topic, { config: { private: true } });
  const timeoutMs = input.timeoutMs ?? 90_000;

  try {
    const wrappedPromise = waitForWrappedKey(channel, timeoutMs);
    await subscribeChannel(channel);
    await sendVaultBroadcast(channel, {
      type: "code_submitted",
      code: normalized,
      deviceId: input.requesterDeviceId,
    });

    const wrapped = await wrappedPromise;
    const vaultKey = await unwrapVaultKeyFromClaim(wrapped, input.requesterPrivateKey);

    const resolvedAt = new Date().toISOString();
    const { error } = await input.client
      .from("vault_claims")
      .update({
        status: "consumed",
        resolved_at: resolvedAt,
      })
      .eq("id", input.claimId)
      .in("status", ["pending", "approved"]);
    if (error) {
      throw new Error(error.message);
    }

    return vaultKey;
  } finally {
    await input.client.removeChannel(channel);
  }
}

export async function cancelVaultClaim(client: SupabaseClient, claimId: string): Promise<void> {
  const { error } = await client
    .from("vault_claims")
    .update({
      status: "cancelled",
      resolved_at: new Date().toISOString(),
    })
    .eq("id", claimId)
    .eq("status", "pending");
  if (error) {
    throw new Error(error.message);
  }
}

/** Increment attempt_count; cancel the claim once VAULT_CLAIM_MAX_ATTEMPTS is reached. */
export async function recordFailedVaultClaimAttempt(
  client: SupabaseClient,
  claim: VaultClaimRow,
): Promise<{ attemptCount: number; locked: boolean }> {
  const attemptCount = (claim.attempt_count ?? 0) + 1;
  const locked = attemptCount >= VAULT_CLAIM_MAX_ATTEMPTS;
  const patch: Record<string, unknown> = { attempt_count: attemptCount };
  if (locked) {
    patch.status = "cancelled";
    patch.resolved_at = new Date().toISOString();
  }
  const { error } = await client
    .from("vault_claims")
    .update(patch)
    .eq("id", claim.id)
    .eq("status", "pending");
  if (error) {
    throw new Error(error.message);
  }
  return { attemptCount, locked };
}

async function loadClaim(client: SupabaseClient, claimId: string): Promise<VaultClaimRow> {
  const { data, error } = await client
    .from("vault_claims")
    .select(
      "id, user_id, requester_device_id, approver_device_id, code_hash, requester_public_key, wrapped_vault_key, wrap_nonce, status, attempt_count, expires_at, created_at, resolved_at",
    )
    .eq("id", claimId)
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Vault claim not found.");
  }
  return data as VaultClaimRow;
}

function assertClaimPending(claim: VaultClaimRow): void {
  if (claim.status !== "pending") {
    throw new VaultClaimError(`Claim is ${claim.status}.`, "vault_claim_not_pending");
  }
  if (Date.parse(claim.expires_at) <= Date.now()) {
    throw new VaultClaimError("Claim has expired.", "vault_claim_expired");
  }
}

function parseVaultBroadcast(payload: unknown): VaultBroadcast | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const body = (record.payload !== undefined ? record.payload : payload) as Record<string, unknown>;
  if (!body || typeof body !== "object") {
    return null;
  }
  if (body.type === "code_submitted" && typeof body.code === "string" && typeof body.deviceId === "string") {
    return { type: "code_submitted", code: body.code, deviceId: body.deviceId };
  }
  if (body.type === "wrapped_key" && isWrappedVaultKey(body.wrapped) && typeof body.approverDeviceId === "string") {
    return {
      type: "wrapped_key",
      wrapped: body.wrapped,
      approverDeviceId: body.approverDeviceId,
    };
  }
  if (body.type === "reject" && typeof body.message === "string") {
    return {
      type: "reject",
      message: body.message,
      ...(typeof body.code === "string" ? { code: body.code } : {}),
    };
  }
  return null;
}

async function sendVaultBroadcast(channel: RealtimeChannel, message: VaultBroadcast): Promise<void> {
  const result = await channel.send({
    type: "broadcast",
    event: VAULT_CLAIM_BROADCAST_EVENT,
    payload: message,
  });
  if (result !== "ok") {
    throw new Error(`Failed to send vault broadcast: ${String(result)}`);
  }
}

function waitForWrappedKey(channel: RealtimeChannel, timeoutMs: number): Promise<WrappedVaultKey> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new VaultClaimError("Timed out waiting for vault key transfer.", "vault_claim_timeout"));
    }, timeoutMs);

    channel.on("broadcast", { event: VAULT_CLAIM_BROADCAST_EVENT }, (payload) => {
      const message = parseVaultBroadcast(payload);
      if (!message) {
        return;
      }
      if (message.type === "wrapped_key") {
        clearTimeout(timer);
        resolve(message.wrapped);
        return;
      }
      if (message.type === "reject") {
        clearTimeout(timer);
        reject(new VaultClaimError(message.message, message.code ?? "vault_claim_rejected"));
      }
    });
  });
}

function subscribeChannel(channel: RealtimeChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    channel.subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        resolve();
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reject(err ?? new Error(`Vault claim channel failed: ${status}`));
      }
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Pure helper: build claim insert shape (unit-tested). */
export function buildVaultClaimInsertRow(input: {
  userId: string;
  requesterDeviceId: string;
  requesterPublicKey: string;
  expiresAt: string;
}): Record<string, unknown> {
  return {
    user_id: input.userId,
    requester_device_id: input.requesterDeviceId,
    requester_public_key: input.requesterPublicKey,
    status: "pending",
    expires_at: input.expiresAt,
  };
}
