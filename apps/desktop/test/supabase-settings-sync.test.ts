import { expect, test } from "bun:test";
import { generateVaultClaimKeyPair, generateVaultKey, wrapVaultKeyForClaim } from "@eco/shared";
import { MobileRemoteEventPublisher } from "../src/main/mobile-remote-event-publisher";
import {
  emptyEcoSyncedSettingsPayload,
  ecoSyncedSettingsPayloadEqual,
  encryptDecryptSecretRoundtrip,
  ensureLocalVaultKey,
  isEcoSyncedSettingsPayload,
  pushAccountConfigSnapshot,
  pushUserSettings,
  SETTINGS_SYNC_CONFLICT_CODE,
  SETTINGS_SYNC_VAULT_DECRYPT_CODE,
  SETTINGS_SYNC_VAULT_REQUIRED_CODE,
  SettingsSyncConflictError,
  syncAccountConfig,
} from "../src/main/supabase-settings-sync";
import {
  recordFailedVaultClaimAttempt,
  submitVaultClaimCodeAndReceiveKey,
  toVaultClaimView,
  VAULT_CLAIM_LOCKED_CODE,
  VAULT_CLAIM_MAX_ATTEMPTS,
  VAULT_NO_SYNCED_DEVICE_CODE,
  VAULT_NO_SYNCED_PEER_CODE,
  type VaultClaimRow,
} from "../src/main/supabase-vault-claim";
import type { EventCenterEnvelope, EventCenterJsonRpcNotification } from "../src/shared/event-center";

test("eco synced settings payload validation", () => {
  expect(isEcoSyncedSettingsPayload(emptyEcoSyncedSettingsPayload())).toBe(true);
  expect(isEcoSyncedSettingsPayload({ version: 1 })).toBe(false);
  expect(isEcoSyncedSettingsPayload(null)).toBe(false);
});

test("ecoSyncedSettingsPayloadEqual compares JSON snapshots", () => {
  const base = emptyEcoSyncedSettingsPayload();
  expect(ecoSyncedSettingsPayloadEqual(base, { ...base })).toBe(true);
  expect(
    ecoSyncedSettingsPayloadEqual(base, {
      version: 1,
      providers: [],
      asr: { activeProfileId: "", profiles: [] },
      imageGeneration: { enabled: false, activeProfileId: "", profiles: [] },
      // Older cloud payloads omit orchestration arrays — still equal to empty local.
    }),
  ).toBe(true);
  expect(
    ecoSyncedSettingsPayloadEqual(base, {
      ...base,
      providers: [
        {
          id: "p1",
          name: "P",
          baseUrl: "https://x",
          requestPath: "/v1",
          version: "1",
          apiCompat: "openai",
          defaultModel: "m",
          enabled: true,
        },
      ],
    }),
  ).toBe(false);
});

test("ensureLocalVaultKey creates once then reuses", async () => {
  let stored = "";
  const first = await ensureLocalVaultKey(
    () => stored,
    (key) => {
      stored = key;
    },
  );
  expect(first.created).toBe(true);
  expect(first.vaultKey.length).toBeGreaterThan(20);
  const second = await ensureLocalVaultKey(
    () => stored,
    (key) => {
      stored = key;
    },
  );
  expect(second.created).toBe(false);
  expect(second.vaultKey).toBe(first.vaultKey);
});

test("encryptDecryptSecretRoundtrip preserves API key plaintext", async () => {
  const vaultKey = await generateVaultKey();
  const plaintext = "sk-test-provider-secret";
  const roundtrip = await encryptDecryptSecretRoundtrip(vaultKey, plaintext);
  expect(roundtrip).toBe(plaintext);
});

test("toVaultClaimView maps row fields", () => {
  const view = toVaultClaimView({
    id: "claim_1",
    user_id: "user_1",
    requester_device_id: "dev_req",
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
  });
  expect(view.id).toBe("claim_1");
  expect(view.requesterDeviceId).toBe("dev_req");
  expect(view.status).toBe("pending");
  expect(VAULT_NO_SYNCED_DEVICE_CODE).toBe("vault_no_synced_device");
  expect(VAULT_NO_SYNCED_PEER_CODE).toBe("vault_no_synced_device_online");
});

test("pushUserSettings uses revision CAS and surfaces conflict", async () => {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      expect(table).toBe("user_settings");
      return {
        update() {
          calls.push("update");
          const chain = {
            eq() {
              return chain;
            },
            select() {
              return chain;
            },
            async maybeSingle() {
              return { data: null, error: null };
            },
          };
          return chain;
        },
        insert() {
          calls.push("insert");
          const chain = {
            select() {
              return chain;
            },
            async single() {
              return {
                data: {
                  user_id: "u1",
                  payload: emptyEcoSyncedSettingsPayload(),
                  updated_at: "t",
                  revision: 1,
                },
                error: null,
              };
            },
          };
          return chain;
        },
      };
    },
  };

  await expect(
    pushUserSettings(client as never, "u1", emptyEcoSyncedSettingsPayload(), 3),
  ).rejects.toMatchObject({
    name: "SettingsSyncConflictError",
    code: SETTINGS_SYNC_CONFLICT_CODE,
  });

  const created = await pushUserSettings(client as never, "u1", emptyEcoSyncedSettingsPayload());
  expect(created.revision).toBe(1);
  expect(calls).toContain("update");
  expect(calls).toContain("insert");
  expect(new SettingsSyncConflictError().code).toBe(SETTINGS_SYNC_CONFLICT_CODE);
});

test("pushAccountConfigSnapshot sends settings and complete secret snapshot to one RPC", async () => {
  let called = 0;
  const client = {
    async rpc(name: string, params: Record<string, unknown>) {
      called += 1;
      expect(name).toBe("eco_replace_account_config");
      expect(params.p_expected_revision).toBe(4);
      expect(params.p_payload).toEqual(emptyEcoSyncedSettingsPayload());
      expect(params.p_secrets).toEqual([
        {
          secret_kind: "provider",
          secret_key: "p1",
          ciphertext: "cipher",
          nonce: "nonce",
          key_version: 1,
        },
      ]);
      return {
        data: [
          {
            user_id: "u1",
            payload: params.p_payload,
            updated_at: "t",
            revision: 5,
          },
        ],
        error: null,
      };
    },
  };
  const row = await pushAccountConfigSnapshot(client as never, {
    payload: emptyEcoSyncedSettingsPayload(),
    expectedRevision: 4,
    secrets: [
      {
        secret_kind: "provider",
        secret_key: "p1",
        ciphertext: "cipher",
        nonce: "nonce",
        key_version: 1,
      },
    ],
  });
  expect(called).toBe(1);
  expect(row.revision).toBe(5);
});

test("recordFailedVaultClaimAttempt locks after max attempts", async () => {
  const updates: Array<Record<string, unknown>> = [];
  const claim: VaultClaimRow = {
    id: "claim_1",
    user_id: "user_1",
    requester_device_id: "dev_req",
    approver_device_id: "dev_appr",
    code_hash: "hash",
    requester_public_key: "pk",
    wrapped_vault_key: null,
    wrap_nonce: null,
    status: "pending",
    attempt_count: VAULT_CLAIM_MAX_ATTEMPTS - 1,
    expires_at: "2030-01-01T00:00:00.000Z",
    created_at: "2030-01-01T00:00:00.000Z",
    resolved_at: null,
  };
  const client = {
    from() {
      const chain = {
        eq() {
          return chain;
        },
        then(resolve: (value: { error: null }) => void) {
          resolve({ error: null });
        },
      };
      return {
        update(patch: Record<string, unknown>) {
          updates.push(patch);
          return chain;
        },
      };
    },
  };

  const result = await recordFailedVaultClaimAttempt(client as never, claim);
  expect(result.locked).toBe(true);
  expect(result.attemptCount).toBe(VAULT_CLAIM_MAX_ATTEMPTS);
  expect(updates[0]?.status).toBe("cancelled");
  expect(VAULT_CLAIM_LOCKED_CODE).toBe("vault_claim_locked");
});

test("approved vault claim recovers wrapped key from database after restart", async () => {
  const vaultKey = await generateVaultKey();
  const requester = await generateVaultClaimKeyPair();
  const wrapped = await wrapVaultKeyForClaim(vaultKey, requester.publicKey);
  const claim: VaultClaimRow = {
    id: "claim_approved",
    user_id: "user_1",
    requester_device_id: "dev_req",
    approver_device_id: "dev_approver",
    code_hash: "hash",
    requester_public_key: requester.publicKey,
    wrapped_vault_key: JSON.stringify(wrapped),
    wrap_nonce: wrapped.nonce,
    status: "approved",
    attempt_count: 0,
    expires_at: "2030-01-01T00:00:00.000Z",
    created_at: "2029-01-01T00:00:00.000Z",
    resolved_at: "2029-01-01T00:01:00.000Z",
  };
  let consumed = false;
  const client = {
    from(table: string) {
      expect(table).toBe("vault_claims");
      return {
        select() {
          const query = {
            eq() {
              return query;
            },
            async single() {
              return { data: claim, error: null };
            },
          };
          return query;
        },
        update(patch: Record<string, unknown>) {
          expect(patch.status).toBe("consumed");
          const query = {
            eq(_column: string, value: string) {
              if (value === "approved") consumed = true;
              return query;
            },
            then(resolve: (value: { error: null }) => void) {
              resolve({ error: null });
            },
          };
          return query;
        },
      };
    },
  };

  const recovered = await submitVaultClaimCodeAndReceiveKey({
    client: client as never,
    claimId: claim.id,
    requesterDeviceId: claim.requester_device_id,
    requesterPrivateKey: requester.privateKey,
    code: "123456",
  });
  expect(recovered).toBe(vaultKey);
  expect(consumed).toBe(true);
});

test("syncAccountConfig pull rejects settings and secrets together without vault key", async () => {
  const { syncAccountConfig, emptyEcoSyncedSettingsPayload } = await import(
    "../src/main/supabase-settings-sync"
  );
  let applied = false;
  let pushed = false;
  const remotePayload = {
    ...emptyEcoSyncedSettingsPayload(),
    providers: [
      {
        id: "p1",
        name: "Cloud",
        baseUrl: "https://x",
        requestPath: "/v1",
        version: "1",
        apiCompat: "openai",
        defaultModel: "m",
        enabled: true,
      },
    ],
  };
  const client = {
    from(table: string) {
      if (table === "user_settings") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return {
              data: {
                user_id: "u1",
                payload: remotePayload,
                updated_at: "t",
                revision: 2,
              },
              error: null,
            };
          },
          upsert() {
            pushed = true;
            return this;
          },
          insert() {
            pushed = true;
            return this;
          },
          update() {
            pushed = true;
            return this;
          },
        };
      }
      if (table === "user_secrets") {
        return {
          select() {
            return this;
          },
          eq() {
            return Promise.resolve({ data: [], error: null });
          },
        };
      }
      return {
        rpc() {
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
    rpc() {
      return Promise.resolve({ data: "t", error: null });
    },
  };
  await expect(
    syncAccountConfig({
      client: client as never,
      userId: "u1",
      deviceId: "d1",
      getVaultKey: () => "",
      saveVaultKey: () => {},
      allowCreateVaultKey: false,
      mode: "pull",
      hooks: {
        collectSettingsPayload: () => emptyEcoSyncedSettingsPayload(),
        applySettingsPayload: async () => {
          applied = true;
        },
        collectPlainSecrets: () => [],
        applyPlainSecrets: async () => {},
      },
    }),
  ).rejects.toMatchObject({ code: SETTINGS_SYNC_VAULT_REQUIRED_CODE });
  expect(applied).toBe(false);
  expect(pushed).toBe(false);
});

test("syncAccountConfig pull applies remote settings after vault check", async () => {
  const { syncAccountConfig, emptyEcoSyncedSettingsPayload } = await import(
    "../src/main/supabase-settings-sync"
  );
  const remotePayload = {
    ...emptyEcoSyncedSettingsPayload(),
    providers: [
      {
        id: "p1",
        name: "Cloud",
        baseUrl: "https://x",
        requestPath: "/v1",
        version: "1",
        apiCompat: "openai",
        defaultModel: "m",
        enabled: true,
      },
    ],
  };
  const client = {
    from(table: string) {
      const chain = {
        select() {
          return chain;
        },
        eq() {
          if (table === "user_secrets") {
            return Promise.resolve({ data: [], error: null });
          }
          return chain;
        },
        async maybeSingle() {
          return {
            data: {
              user_id: "u1",
              payload: remotePayload,
              updated_at: "t",
              revision: 2,
            },
            error: null,
          };
        },
      };
      return chain;
    },
    rpc() {
      return Promise.resolve({ data: null, error: null });
    },
  };
  let applied = false;
  const result = await syncAccountConfig({
    client: client as never,
    userId: "u1",
    deviceId: "d1",
    getVaultKey: () => "vk",
    saveVaultKey: () => {},
    allowCreateVaultKey: false,
    mode: "pull",
    hooks: {
      collectSettingsPayload: () => emptyEcoSyncedSettingsPayload(),
      applySettingsPayload: () => {
        applied = true;
      },
      collectPlainSecrets: () => [],
      applyPlainSecrets: async () => {},
    },
  });
  expect(applied).toBe(true);
  expect(result.settingsPulled).toBe(true);
  expect(result.cloudEmpty).toBeUndefined();
});

test("syncAccountConfig pull reports cloudEmpty when remote settings missing", async () => {
  const { syncAccountConfig, emptyEcoSyncedSettingsPayload } = await import(
    "../src/main/supabase-settings-sync"
  );
  const client = {
    from(table: string) {
      const chain = {
        select() {
          return chain;
        },
        eq() {
          if (table === "user_secrets") {
            return Promise.resolve({ data: [], error: null });
          }
          return chain;
        },
        async maybeSingle() {
          return { data: null, error: null };
        },
      };
      return chain;
    },
    rpc() {
      return Promise.resolve({ data: null, error: null });
    },
  };
  let applied = false;
  const result = await syncAccountConfig({
    client: client as never,
    userId: "u1",
    deviceId: "d1",
    getVaultKey: () => "vk",
    saveVaultKey: () => {},
    allowCreateVaultKey: false,
    mode: "pull",
    hooks: {
      collectSettingsPayload: () => emptyEcoSyncedSettingsPayload(),
      applySettingsPayload: () => {
        applied = true;
      },
      collectPlainSecrets: () => [],
      applyPlainSecrets: async () => {},
    },
  });
  expect(applied).toBe(false);
  expect(result.settingsPulled).toBe(false);
  expect(result.cloudEmpty).toBe(true);
});

test("syncAccountConfig reports the corrupt secret and applies none of the snapshot", async () => {
  const vaultKey = await generateVaultKey();
  const remotePayload = {
    ...emptyEcoSyncedSettingsPayload(),
    providers: [
      {
        id: "provider-corrupt",
        name: "Cloud",
        baseUrl: "https://x",
        requestPath: "/v1",
        version: "1",
        apiCompat: "openai",
        defaultModel: "m",
        enabled: true,
      },
    ],
  };
  const client = {
    from(table: string) {
      const chain = {
        select() {
          return chain;
        },
        eq() {
          if (table === "user_secrets") {
            return Promise.resolve({
              data: [
                {
                  id: "secret-1",
                  user_id: "u1",
                  secret_kind: "provider",
                  secret_key: "provider-corrupt",
                  ciphertext: "not-valid-ciphertext",
                  nonce: "not-valid-nonce",
                  key_version: 1,
                  updated_at: "t",
                },
              ],
              error: null,
            });
          }
          return chain;
        },
        async maybeSingle() {
          return {
            data: {
              user_id: "u1",
              payload: remotePayload,
              updated_at: "t",
              revision: 2,
            },
            error: null,
          };
        },
      };
      return chain;
    },
  };
  let settingsApplied = false;
  let secretsApplied = false;

  await expect(
    syncAccountConfig({
      client: client as never,
      userId: "u1",
      deviceId: "d1",
      getVaultKey: () => vaultKey,
      saveVaultKey: () => {},
      allowCreateVaultKey: false,
      mode: "pull",
      hooks: {
        collectSettingsPayload: () => emptyEcoSyncedSettingsPayload(),
        applySettingsPayload: () => {
          settingsApplied = true;
        },
        collectPlainSecrets: () => [],
        applyPlainSecrets: () => {
          secretsApplied = true;
        },
      },
    }),
  ).rejects.toMatchObject({
    code: SETTINGS_SYNC_VAULT_DECRYPT_CODE,
    message: expect.stringContaining("provider:provider-corrupt"),
  });
  expect(settingsApplied).toBe(false);
  expect(secretsApplied).toBe(false);
});

test("syncAccountConfig reconcile asks user when both sides differ", async () => {
  const { syncAccountConfig, emptyEcoSyncedSettingsPayload } = await import(
    "../src/main/supabase-settings-sync"
  );
  const local = {
    ...emptyEcoSyncedSettingsPayload(),
    providers: [
      {
        id: "local",
        name: "Local",
        baseUrl: "https://l",
        requestPath: "/v1",
        version: "1",
        apiCompat: "openai",
        defaultModel: "m",
        enabled: true,
      },
    ],
  };
  const remote = {
    ...emptyEcoSyncedSettingsPayload(),
    providers: [
      {
        id: "remote",
        name: "Remote",
        baseUrl: "https://r",
        requestPath: "/v1",
        version: "1",
        apiCompat: "openai",
        defaultModel: "m",
        enabled: true,
      },
    ],
  };
  const client = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return {
            data: { user_id: "u1", payload: remote, updated_at: "t", revision: 3 },
            error: null,
          };
        },
      };
    },
    rpc() {
      return Promise.resolve({ data: null, error: null });
    },
  };
  let applied = false;
  const result = await syncAccountConfig({
    client: client as never,
    userId: "u1",
    deviceId: "d1",
    getVaultKey: () => "vk",
    saveVaultKey: () => {},
    allowCreateVaultKey: false,
    mode: "reconcile",
    hooks: {
      collectSettingsPayload: () => local,
      applySettingsPayload: async () => {
        applied = true;
      },
      collectPlainSecrets: () => [],
      applyPlainSecrets: async () => {},
    },
  });
  expect(result.needsUserChoice).toBe(true);
  expect(applied).toBe(false);
  expect(result.settingsPulled).toBe(false);
  expect(result.settingsPushed).toBe(false);
});

test("MobileRemoteEventPublisher throttles context notifications", async () => {
  const delivered: EventCenterJsonRpcNotification[] = [];
  const publisher = new MobileRemoteEventPublisher({
    deliver: (notification) => {
      delivered.push(notification);
    },
    contextUsageThrottleMs: 30,
  });

  const envelope = {
    kind: "thread.context",
    threadId: "thr_1",
    payload: { type: "context", threadId: "thr_1" },
  } as EventCenterEnvelope;
  const n1 = { jsonrpc: "2.0", method: "eco.event", params: envelope } as EventCenterJsonRpcNotification;
  const n2 = {
    jsonrpc: "2.0",
    method: "eco.event",
    params: { ...envelope, payload: { type: "context", threadId: "thr_1", seq: 2 } },
  } as EventCenterJsonRpcNotification;

  publisher.publish(envelope, n1);
  publisher.publish(envelope, n2);
  expect(delivered).toHaveLength(0);
  await Bun.sleep(50);
  expect(delivered).toHaveLength(1);
  expect((delivered[0]!.params as EventCenterEnvelope).payload).toEqual({
    type: "context",
    threadId: "thr_1",
    seq: 2,
  });
  publisher.reset();
});
