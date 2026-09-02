import { expect, test } from "bun:test";
import {
  encryptSecretWithVaultKey,
  generateVaultClaimKeyPair,
  generateVaultKey,
  wrapVaultKeyForClaim,
} from "@eco/shared";
import { MobileRemoteEventPublisher } from "../src/main/mobile-remote-event-publisher";
import {
  ecoSyncedSettingsPayloadEqual,
  emptyEcoSyncedSettingsPayload,
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

test("syncAccountConfig reconcile preserves local secrets when settings already match", async () => {
  const payload = {
    ...emptyEcoSyncedSettingsPayload(),
    providers: [
      {
        id: "provider-shared",
        name: "Shared",
        baseUrl: "https://shared.example.com",
        requestPath: "/v1",
        version: "1",
        apiCompat: "openai",
        defaultModel: "model",
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
            data: { user_id: "u1", payload, updated_at: "t", revision: 3 },
            error: null,
          };
        },
      };
      return chain;
    },
  };
  let secretsApplied = false;

  const result = await syncAccountConfig({
    client: client as never,
    userId: "u1",
    deviceId: "d1",
    getVaultKey: () => "vk",
    saveVaultKey: () => {},
    allowCreateVaultKey: false,
    mode: "reconcile",
    hooks: {
      collectSettingsPayload: () => payload,
      applySettingsPayload: async () => {},
      collectPlainSecrets: () => [{ kind: "workflow", key: "acp_cursor_api_key", value: "ck-local" }],
      applyPlainSecrets: () => {
        secretsApplied = true;
      },
    },
  });

  expect(secretsApplied).toBe(false);
  expect(result.secretsPulled).toBe(0);
  expect(result.settingsPulled).toBe(false);
  expect(result.settingsPushed).toBe(false);
  expect(result.needsUserChoice).toBeUndefined();
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

test("syncAccountConfigDomain push merges only the requested domain", async () => {
  const { syncAccountConfigDomain, emptyEcoSyncedSettingsPayload, mergeDomainIntoPayload } = await import(
    "../src/main/supabase-settings-sync"
  );

  const remote = {
    ...emptyEcoSyncedSettingsPayload(),
    providers: [
      {
        id: "remote-provider",
        name: "Remote",
        baseUrl: "https://remote",
        requestPath: "/v1",
        version: "1",
        apiCompat: "openai",
        defaultModel: "m",
        enabled: true,
      },
    ],
    asr: {
      activeProfileId: "asr-remote",
      profiles: [
        {
          id: "asr-remote",
          name: "Remote ASR",
          endpoint: "https://asr",
          apiMode: "chat_completions",
          model: "m",
          systemPrompt: "",
        },
      ],
    },
  };
  const local = mergeDomainIntoPayload(
    remote,
    {
      ...emptyEcoSyncedSettingsPayload(),
      providers: [
        {
          id: "local-provider",
          name: "Local",
          baseUrl: "https://local",
          requestPath: "/v1",
          version: "1",
          apiCompat: "openai",
          defaultModel: "m",
          enabled: true,
        },
      ],
    },
    "providers",
  );

  let pushedPayload: typeof remote | undefined;
  const client = {
    from(table: string) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          if (table === "user_settings") {
            return {
              data: { user_id: "u1", payload: remote, updated_at: "t", revision: 2 },
              error: null,
            };
          }
          return { data: [], error: null };
        },
      };
    },
    rpc(name: string, args: { p_payload: typeof remote }) {
      if (name === "eco_replace_account_config") {
        pushedPayload = args.p_payload;
      }
      return Promise.resolve({
        data: [{ user_id: "u1", payload: args.p_payload, updated_at: "t", revision: 3 }],
        error: null,
      });
    },
  };

  await syncAccountConfigDomain({
    client: client as never,
    userId: "u1",
    deviceId: "d1",
    domain: "providers",
    getVaultKey: () => "vk",
    saveVaultKey: () => {},
    allowCreateVaultKey: false,
    mode: "push",
    hooks: {
      collectSettingsPayload: () => local,
      applySettingsPayload: async () => {},
      collectPlainSecrets: () => [],
      applyPlainSecrets: async () => {},
      applyDomainPlainSecrets: async () => {},
    },
  });

  expect(pushedPayload?.providers[0]?.id).toBe("local-provider");
  expect(pushedPayload?.asr.activeProfileId).toBe("asr-remote");
});

test("defaultAgent is secrets-only and omitted from sync status domains", async () => {
  const { ECO_SETTINGS_SYNC_DOMAINS, isSecretsOnlySyncDomain } = await import(
    "../src/main/supabase-settings-sync"
  );

  expect(ECO_SETTINGS_SYNC_DOMAINS).not.toContain("defaultAgent");
  expect(isSecretsOnlySyncDomain("defaultAgent")).toBe(true);
  expect(isSecretsOnlySyncDomain("providers")).toBe(false);
});

test("defaultAgent domain push keeps remote workflow payload and only pushes secrets", async () => {
  const { syncAccountConfigDomain, emptyEcoSyncedSettingsPayload, ECO_WORKFLOW_CURSOR_API_KEY_SECRET } =
    await import("../src/main/supabase-settings-sync");

  const remote = {
    ...emptyEcoSyncedSettingsPayload(),
    workflow: {
      sessionMode: "agent" as const,
      defaultCoreKind: "claude" as const,
      contextWindowLimitTokens: 262_144,
      maxOutputLimitTokens: 32_768,
      followUpDeliveryMode: "steer" as const,
    },
  };

  let pushedPayload: typeof remote | undefined;
  let pushedSecrets: unknown;
  const vaultKey = await generateVaultKey();
  const client = {
    from(table: string) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          if (table === "user_settings") {
            return {
              data: { user_id: "u1", payload: remote, updated_at: "t", revision: 2 },
              error: null,
            };
          }
          return { data: [], error: null };
        },
      };
    },
    rpc(name: string, args: { p_payload: typeof remote; p_secrets: unknown }) {
      if (name === "eco_replace_account_config") {
        pushedPayload = args.p_payload;
        pushedSecrets = args.p_secrets;
      }
      return Promise.resolve({
        data: [{ user_id: "u1", payload: args.p_payload, updated_at: "t", revision: 3 }],
        error: null,
      });
    },
  };

  const result = await syncAccountConfigDomain({
    client: client as never,
    userId: "u1",
    deviceId: "d1",
    domain: "defaultAgent",
    getVaultKey: () => vaultKey,
    saveVaultKey: () => {},
    allowCreateVaultKey: false,
    mode: "push",
    hooks: {
      collectSettingsPayload: () => ({
        ...emptyEcoSyncedSettingsPayload(),
        workflow: {
          sessionMode: "agent",
          defaultCoreKind: "codex",
          contextWindowLimitTokens: 262_144,
          maxOutputLimitTokens: 32_768,
          followUpDeliveryMode: "steer",
        },
      }),
      applySettingsPayload: async () => {},
      collectPlainSecrets: () => [
        { kind: "workflow", key: ECO_WORKFLOW_CURSOR_API_KEY_SECRET, value: "ck-local" },
      ],
      applyPlainSecrets: async () => {},
      applyDomainPlainSecrets: async () => {},
    },
  });

  expect(result.settingsPushed).toBe(false);
  expect(result.secretsPushed).toBe(1);
  expect(pushedPayload?.workflow?.defaultCoreKind).toBe("claude");
  expect(Array.isArray(pushedSecrets)).toBe(true);
});

test("defaultAgent domain pull applies secrets without replacing workflow settings", async () => {
  const { syncAccountConfigDomain, emptyEcoSyncedSettingsPayload, ECO_WORKFLOW_CURSOR_API_KEY_SECRET } =
    await import("../src/main/supabase-settings-sync");

  const remote = emptyEcoSyncedSettingsPayload();
  const vaultKey = await generateVaultKey();
  const sealed = await encryptSecretWithVaultKey(vaultKey, "ck-cloud");

  let appliedPayload = false;
  let appliedDomainSecrets: unknown;
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
                  id: "sec_1",
                  user_id: "u1",
                  secret_kind: "workflow",
                  secret_key: ECO_WORKFLOW_CURSOR_API_KEY_SECRET,
                  ciphertext: sealed.ciphertext,
                  nonce: sealed.nonce,
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
          if (table === "user_settings") {
            return {
              data: { user_id: "u1", payload: remote, updated_at: "t", revision: 2 },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
    rpc() {
      return Promise.resolve({ data: null, error: null });
    },
  };

  const result = await syncAccountConfigDomain({
    client: client as never,
    userId: "u1",
    deviceId: "d1",
    domain: "defaultAgent",
    getVaultKey: () => vaultKey,
    saveVaultKey: () => {},
    allowCreateVaultKey: false,
    mode: "pull",
    hooks: {
      collectSettingsPayload: () => emptyEcoSyncedSettingsPayload(),
      applySettingsPayload: async () => {
        appliedPayload = true;
      },
      collectPlainSecrets: () => [],
      applyPlainSecrets: async () => {},
      applyDomainPlainSecrets: async (secrets) => {
        appliedDomainSecrets = secrets;
      },
    },
  });

  expect(result.settingsPulled).toBe(false);
  expect(result.secretsPulled).toBe(1);
  expect(appliedPayload).toBe(false);
  expect(appliedDomainSecrets).toEqual([
    { kind: "workflow", key: ECO_WORKFLOW_CURSOR_API_KEY_SECRET, value: "ck-cloud" },
  ]);
});

test("mergeDomainIntoPayload replaces only git settings", async () => {
  const { mergeDomainIntoPayload, emptyEcoSyncedSettingsPayload } = await import(
    "../src/main/supabase-settings-sync"
  );

  const remote = {
    ...emptyEcoSyncedSettingsPayload(),
    git: {
      commitMessageRoleByMainAgentConfigId: { main_1: "coder" },
      commitMessageCandidateModelIdByMainAgentConfigId: {},
      commitMessageInstructions: "Use conventional commits",
    },
  };
  const local = {
    ...emptyEcoSyncedSettingsPayload(),
    git: {
      commitMessageRoleByMainAgentConfigId: {},
      commitMessageCandidateModelIdByMainAgentConfigId: {},
      commitMessageInstructions: "Local only",
    },
    packageScriptArgs: {
      "/tmp/project": { dev: "--port 3000" },
    },
  };

  const merged = mergeDomainIntoPayload(local, remote, "git");
  expect(merged.git?.commitMessageInstructions).toBe("Use conventional commits");
  expect(merged.packageScriptArgs).toEqual(local.packageScriptArgs);
});

test("mergeDomainIntoPayload replaces only packageScriptArgs", async () => {
  const { mergeDomainIntoPayload, emptyEcoSyncedSettingsPayload } = await import(
    "../src/main/supabase-settings-sync"
  );

  const remote = {
    ...emptyEcoSyncedSettingsPayload(),
    packageScriptArgs: {
      "/other/machine/project": { build: "--verbose" },
    },
  };
  const local = {
    ...emptyEcoSyncedSettingsPayload(),
    git: {
      commitMessageRoleByMainAgentConfigId: {},
      commitMessageCandidateModelIdByMainAgentConfigId: {},
      commitMessageInstructions: "Keep local git",
    },
    packageScriptArgs: {
      "/tmp/project": { dev: "--port 3000" },
    },
  };

  const merged = mergeDomainIntoPayload(local, remote, "packageScriptArgs");
  expect(merged.packageScriptArgs).toEqual(remote.packageScriptArgs);
  expect(merged.git?.commitMessageInstructions).toBe("Keep local git");
});

test("mergeDomainIntoPayload replaces only user agent templates for agentLibrary", async () => {
  const { mergeDomainIntoPayload, emptyEcoSyncedSettingsPayload, syncableAgentTemplates } = await import(
    "../src/main/supabase-settings-sync"
  );

  const userTemplate = {
    id: "user.agent.review",
    name: "Review",
    description: "",
    prompt: "Review code",
    whenToUse: "",
    defaultTools: { allowed: [], disallowed: [] },
    mcpServers: [],
    skills: [],
    allowDelegation: false,
    builtIn: false,
    source: "user" as const,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const builtInTemplate = {
    ...userTemplate,
    id: "builtin.coding.coder",
    name: "Coder",
    builtIn: true,
    source: "built_in" as const,
  };
  const remote = {
    ...emptyEcoSyncedSettingsPayload(),
    agentTemplates: [userTemplate, builtInTemplate],
    mainAgentConfigs: [
      {
        id: "remote-main",
        name: "Remote",
        agentKey: "k",
        modelRef: { kind: "route" as const, routeProfileId: "r" },
        tools: { allowed: [], disallowed: [] },
        skills: [],
        source: "user" as const,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
  const local = {
    ...emptyEcoSyncedSettingsPayload(),
    agentTemplates: [],
    mainAgentConfigs: [
      {
        id: "local-main",
        name: "Local",
        agentKey: "k",
        modelRef: { kind: "route" as const, routeProfileId: "r" },
        tools: { allowed: [], disallowed: [] },
        skills: [],
        source: "user" as const,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };

  const merged = mergeDomainIntoPayload(local, remote, "agentLibrary");
  expect(syncableAgentTemplates(merged.agentTemplates)).toEqual([userTemplate]);
  expect(merged.mainAgentConfigs?.[0]?.id).toBe("local-main");

  const orchestrationMerged = mergeDomainIntoPayload(local, remote, "orchestration");
  expect(orchestrationMerged.mainAgentConfigs?.[0]?.id).toBe("remote-main");
  expect(orchestrationMerged.agentTemplates).toEqual([]);
});

test("domainPayloadEqual ignores orchestration updatedAt and project-owned rows", async () => {
  const { domainPayloadEqual, emptyEcoSyncedSettingsPayload } = await import(
    "../src/main/supabase-settings-sync"
  );

  const base = emptyEcoSyncedSettingsPayload();
  const local = {
    ...base,
    mainAgentConfigs: [
      {
        id: "main_1",
        name: "Main",
        agentKey: "agent",
        modelRef: { kind: "route" as const, routeProfileId: "route_1" },
        tools: { allowed: [], disallowed: [] },
        skills: [],
        source: "user" as const,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
  const remote = {
    ...base,
    mainAgentConfigs: [
      {
        id: "main_1",
        name: "Main",
        agentKey: "agent",
        modelRef: { kind: "route" as const, routeProfileId: "route_1" },
        tools: { allowed: [], disallowed: [] },
        skills: [],
        source: "user" as const,
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "project_main",
        name: "Project",
        agentKey: "agent",
        modelRef: { kind: "route" as const, routeProfileId: "route_1" },
        tools: { allowed: [], disallowed: [] },
        skills: [],
        source: "project" as const,
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
    ],
  };

  expect(domainPayloadEqual(local, remote, "orchestration")).toBe(true);
});

test("computeDomainSyncStatuses treats default git settings as empty locally", async () => {
  const { computeDomainSyncStatuses, emptyEcoSyncedSettingsPayload } = await import(
    "../src/main/supabase-settings-sync"
  );
  const { defaultGitSettings } = await import("../src/main/git-settings-store");

  const local = {
    ...emptyEcoSyncedSettingsPayload(),
    git: defaultGitSettings(),
  };
  const remote = emptyEcoSyncedSettingsPayload();

  const statuses = computeDomainSyncStatuses({
    localPayload: local,
    remotePayload: remote,
    localSecrets: [],
    remoteSecrets: [],
    hasVaultKey: true,
    domainSyncTimes: {},
  });

  expect(statuses.find((entry) => entry.domain === "git")?.state).toBe("synced");
});

test("computeDomainSyncStatuses marks never_synced when local git changed and cloud empty", async () => {
  const { computeDomainSyncStatuses, emptyEcoSyncedSettingsPayload } = await import(
    "../src/main/supabase-settings-sync"
  );
  const { defaultGitSettings } = await import("../src/main/git-settings-store");

  const local = {
    ...emptyEcoSyncedSettingsPayload(),
    git: {
      ...defaultGitSettings(),
      commitMessageInstructions: "Use conventional commits",
    },
  };

  const statuses = computeDomainSyncStatuses({
    localPayload: local,
    remotePayload: emptyEcoSyncedSettingsPayload(),
    localSecrets: [],
    remoteSecrets: [],
    hasVaultKey: true,
    domainSyncTimes: { git: "2026-01-02T00:00:00.000Z" },
  });

  const git = statuses.find((entry) => entry.domain === "git");
  expect(git?.state).toBe("never_synced");
  expect(git?.lastSyncedAt).toBe("2026-01-02T00:00:00.000Z");
});
