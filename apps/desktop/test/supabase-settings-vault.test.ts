import { expect, test } from "bun:test";
import { generateVaultKey } from "@eco/shared";
import {
  buildVaultClaimInsertRow,
  VAULT_CLAIM_TTL_MS,
  VAULT_NO_SYNCED_PEER_CODE,
} from "../src/main/supabase-vault-claim";
import {
  emptyEcoSyncedSettingsPayload,
  encryptDecryptSecretRoundtrip,
  ensureLocalVaultKey,
  isEcoSyncedSettingsPayload,
} from "../src/main/supabase-settings-sync";

test("settings sync encrypt/decrypt roundtrip preserves API key plaintext", async () => {
  const vaultKey = await generateVaultKey();
  const plaintext = "sk-live-provider-secret-abcdef";
  expect(await encryptDecryptSecretRoundtrip(vaultKey, plaintext)).toBe(plaintext);
});

test("ensureLocalVaultKey creates once then reuses", async () => {
  let stored = "";
  const first = await ensureLocalVaultKey(
    () => stored,
    (value) => {
      stored = value;
    },
  );
  expect(first.created).toBe(true);
  expect(first.vaultKey.length).toBeGreaterThan(0);
  expect(stored).toBe(first.vaultKey);

  const second = await ensureLocalVaultKey(
    () => stored,
    (value) => {
      stored = value;
    },
  );
  expect(second.created).toBe(false);
  expect(second.vaultKey).toBe(first.vaultKey);
});

test("isEcoSyncedSettingsPayload validates versioned payload shape", () => {
  const empty = emptyEcoSyncedSettingsPayload();
  expect(isEcoSyncedSettingsPayload(empty)).toBe(true);
  expect(isEcoSyncedSettingsPayload({ version: 2 })).toBe(false);
  expect(isEcoSyncedSettingsPayload(null)).toBe(false);
});

test("buildVaultClaimInsertRow shapes pending claim insert", () => {
  const expiresAt = new Date(Date.now() + VAULT_CLAIM_TTL_MS).toISOString();
  const row = buildVaultClaimInsertRow({
    userId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    requesterDeviceId: "11111111-2222-3333-4444-555555555555",
    requesterPublicKey: "spki-public-key",
    expiresAt,
  });
  expect(row).toEqual({
    user_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    requester_device_id: "11111111-2222-3333-4444-555555555555",
    requester_public_key: "spki-public-key",
    status: "pending",
    expires_at: expiresAt,
  });
  expect(VAULT_NO_SYNCED_PEER_CODE).toBe("vault_no_synced_device_online");
  expect(VAULT_CLAIM_TTL_MS).toBe(24 * 60 * 60_000);
});

test("createVaultClaim allows offline peers when another device has vault_synced", async () => {
  const { createVaultClaim, VAULT_NO_SYNCED_DEVICE_CODE } = await import(
    "../src/main/supabase-vault-claim"
  );
  let inserted = false;
  const client = {
    from(table: string) {
      if (table === "devices_public") {
        return {
          select() {
            return this;
          },
          not() {
            return this;
          },
          is() {
            return Promise.resolve({
              data: [
                { id: "peer-device", vault_synced_at: "2026-01-01T00:00:00.000Z", disabled_at: null },
              ],
              error: null,
            });
          },
        };
      }
      const chain: Record<string, unknown> = {};
      chain.update = () => chain;
      chain.eq = () => chain;
      chain.insert = () => {
        inserted = true;
        return chain;
      };
      chain.select = () => chain;
      chain.single = async () => ({
        data: {
          id: "claim-new",
          user_id: "user-1",
          requester_device_id: "req-device",
          approver_device_id: null,
          code_hash: null,
          requester_public_key: "pk",
          wrapped_vault_key: null,
          wrap_nonce: null,
          status: "pending",
          attempt_count: 0,
          expires_at: "2030-01-01T00:00:00.000Z",
          created_at: "2030-01-01T00:00:00.000Z",
          resolved_at: null,
        },
        error: null,
      });
      // Make update/eq awaitable no-op for cancel-prior-pending
      (chain as { then?: unknown }).then = (resolve: (v: { error: null }) => void) =>
        resolve({ error: null });
      return chain;
    },
  };

  const result = await createVaultClaim({
    client: client as never,
    userId: "user-1",
    requesterDeviceId: "req-device",
    onlineDeviceIds: new Set(), // empty — previously would fail
  });
  expect(inserted).toBe(true);
  expect(result.claim.id).toBe("claim-new");
  expect(result.requesterPrivateKey.length).toBeGreaterThan(10);
  expect(VAULT_NO_SYNCED_DEVICE_CODE).toBe("vault_no_synced_device");
});
