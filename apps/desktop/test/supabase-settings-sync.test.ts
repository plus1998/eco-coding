import { expect, test } from "bun:test";
import { generateVaultKey } from "@eco/shared";
import { MobileRemoteEventPublisher } from "../src/main/mobile-remote-event-publisher";
import {
  emptyEcoSyncedSettingsPayload,
  ecoSyncedSettingsPayloadEqual,
  encryptDecryptSecretRoundtrip,
  ensureLocalVaultKey,
  isEcoSyncedSettingsPayload,
  pushUserSettings,
  SETTINGS_SYNC_CONFLICT_CODE,
  SettingsSyncConflictError,
} from "../src/main/supabase-settings-sync";
import {
  recordFailedVaultClaimAttempt,
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

test("syncAccountConfig pull does not push local settings", async () => {
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
  const result = await syncAccountConfig({
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
  });
  expect(applied).toBe(true);
  expect(pushed).toBe(false);
  expect(result.settingsPulled).toBe(true);
  expect(result.settingsPushed).toBe(false);
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
