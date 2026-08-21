import { expect, test } from "bun:test";
import { isRemoteCommandChannel } from "../../../packages/shared/src/remote-command-registry";
import {
  ASR_MODEL,
  type AsrSecretCodec,
  AsrSettingsStore,
  DEFAULT_ASR_PROFILE_ID,
} from "../src/main/asr-settings-store";
import { IPC_CHANNELS, isKnownIpcChannel } from "../src/shared/ipc";

interface ProfileRow {
  id: string;
  name: string;
  endpoint: string;
  api_mode: string;
  model: string;
  system_prompt: string;
  encrypted_api_key: string;
  created_at: string;
  updated_at: string;
}

interface GlobalRow {
  active_profile_id: string;
  input_device_id: string | null;
  updated_at: string;
}

class MemoryAsrDatabase {
  readonly profiles = new Map<string, ProfileRow>();
  readonly execCalls: string[] = [];
  readonly runCalls: string[] = [];
  global: GlobalRow | undefined;
  legacySnapshot: string | undefined;
  failGlobalInsert = false;
  schemaSql = "";
  private backup:
    | {
        profiles: Map<string, ProfileRow>;
        global: GlobalRow | undefined;
      }
    | undefined;

  exec(sql: string): void {
    this.execCalls.push(sql.trim());
    const normalized = sql.trim().toUpperCase();
    if (normalized === "PRAGMA FOREIGN_KEYS = ON") {
      return;
    }
    if (normalized === "BEGIN IMMEDIATE") {
      this.backup = {
        profiles: new Map([...this.profiles].map(([id, row]) => [id, { ...row }])),
        global: this.global ? { ...this.global } : undefined,
      };
      return;
    }
    if (normalized === "COMMIT") {
      this.backup = undefined;
      return;
    }
    if (normalized === "ROLLBACK") {
      if (this.backup) {
        this.profiles.clear();
        for (const [id, row] of this.backup.profiles) this.profiles.set(id, row);
        this.global = this.backup.global;
      }
      this.backup = undefined;
      return;
    }
    this.schemaSql += sql;
  }

  prepare(sql: string) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    return {
      get: (...args: unknown[]) => this.get(normalized, args),
      all: () => this.all(normalized),
      run: (...args: unknown[]) => this.run(normalized, args),
    };
  }

  private get(sql: string, args: unknown[]): unknown {
    if (sql.startsWith("SELECT COUNT(*) AS count FROM asr_profiles")) {
      return { count: this.profiles.size };
    }
    if (sql.startsWith("SELECT active_profile_id, input_device_id FROM asr_global_settings")) {
      return this.global
        ? {
            active_profile_id: this.global.active_profile_id,
            input_device_id: this.global.input_device_id,
          }
        : undefined;
    }
    if (sql.startsWith("SELECT value_json FROM asr_settings")) {
      return this.legacySnapshot ? { value_json: this.legacySnapshot } : undefined;
    }
    if (sql.startsWith("SELECT id FROM asr_profiles WHERE name_key = ?")) {
      const [nameKey, excludedId] = args as [string, string];
      const duplicate = [...this.profiles.values()].find(
        (row) => row.id !== excludedId && row.name.toLocaleLowerCase() === nameKey,
      );
      return duplicate ? { id: duplicate.id } : undefined;
    }
    if (sql.includes("FROM asr_profiles WHERE id = ?")) {
      const row = this.profiles.get(String(args[0]));
      return row ? { ...row } : undefined;
    }
    throw new Error(`Unsupported get SQL: ${sql}`);
  }

  private all(sql: string): unknown[] {
    if (sql.includes("FROM asr_profiles") && sql.includes("ORDER BY name COLLATE NOCASE")) {
      return [...this.profiles.values()]
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
        .map((row) => ({ ...row }));
    }
    throw new Error(`Unsupported all SQL: ${sql}`);
  }

  private run(sql: string, args: unknown[]): { changes: number } {
    this.runCalls.push(sql);
    if (sql.startsWith("INSERT INTO asr_profiles")) {
      const [
        id,
        name,
        _nameKey,
        endpoint,
        apiMode,
        model,
        systemPrompt,
        encryptedApiKey,
        createdAt,
        updatedAt,
      ] = args as string[];
      this.profiles.set(id, {
        id,
        name,
        endpoint,
        api_mode: apiMode,
        model,
        system_prompt: systemPrompt,
        encrypted_api_key: encryptedApiKey,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO asr_global_settings")) {
      if (this.failGlobalInsert) throw new Error("simulated global settings write failure");
      const [activeProfileId, updatedAt] = args as string[];
      this.global = {
        active_profile_id: activeProfileId,
        input_device_id: null,
        updated_at: updatedAt,
      };
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE asr_profiles SET")) {
      const [name, _nameKey, endpoint, apiMode, model, systemPrompt, encryptedApiKey, updatedAt, id] =
        args as string[];
      const existing = this.profiles.get(id);
      if (!existing) return { changes: 0 };
      this.profiles.set(id, {
        ...existing,
        name,
        endpoint,
        api_mode: apiMode,
        model,
        system_prompt: systemPrompt,
        encrypted_api_key: encryptedApiKey,
        updated_at: updatedAt,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("DELETE FROM asr_profiles")) {
      return { changes: this.profiles.delete(String(args[0])) ? 1 : 0 };
    }
    if (sql.startsWith("UPDATE asr_global_settings SET active_profile_id")) {
      if (!this.global) return { changes: 0 };
      this.global.active_profile_id = String(args[0]);
      this.global.updated_at = String(args[1]);
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE asr_global_settings SET input_device_id")) {
      if (!this.global) return { changes: 0 };
      this.global.input_device_id = args[0] === null ? null : String(args[0]);
      this.global.updated_at = String(args[1]);
      return { changes: 1 };
    }
    throw new Error(`Unsupported run SQL: ${sql}`);
  }
}

function createCodec(onDecrypt?: () => void): AsrSecretCodec {
  return {
    isAvailable: () => true,
    encrypt: (value) => `encrypted:${btoa(value)}`,
    decrypt: (value) => {
      onDecrypt?.();
      if (!value.startsWith("encrypted:")) throw new Error("keychain unavailable");
      return atob(value.slice("encrypted:".length));
    },
  };
}

test("migrates the legacy snapshot once and preserves its encrypted API key byte-for-byte", () => {
  const db = new MemoryAsrDatabase();
  db.legacySnapshot = JSON.stringify({
    endpoint: "https://example.com/v1/chat/completions",
    apiMode: "audio_transcriptions",
    model: "legacy-model",
    systemPrompt: " legacy prompt ",
    apiKey: "encrypted:c2VjcmV0",
  });
  let decryptCount = 0;
  const store = new AsrSettingsStore(
    db as never,
    createCodec(() => decryptCount++),
  );

  store.initialize();
  store.initialize();

  expect(db.execCalls[0]).toBe("PRAGMA foreign_keys = ON");
  expect(db.execCalls[1]).toBe("BEGIN IMMEDIATE");
  expect(db.execCalls.filter((sql) => sql === "PRAGMA foreign_keys = ON")).toHaveLength(2);
  const migrated = db.profiles.get(DEFAULT_ASR_PROFILE_ID);
  expect(db.profiles.size).toBe(1);
  expect(migrated?.encrypted_api_key).toBe("encrypted:c2VjcmV0");
  expect(store.listProfiles().profiles[0]?.hasApiKey).toBe(true);
  expect(decryptCount).toBe(0);
  expect(store.getClientConfig()?.apiKey).toBe("secret");
  expect(decryptCount).toBe(1);
  expect(db.schemaSql).toContain("name TEXT NOT NULL COLLATE NOCASE UNIQUE");
});

test("rolls back profile insertion when the following global settings write fails", () => {
  const db = new MemoryAsrDatabase();
  db.legacySnapshot = JSON.stringify({
    endpoint: "https://example.com/v1",
    model: "legacy-model",
    systemPrompt: "",
    apiKey: "encrypted:c2VjcmV0",
  });
  db.failGlobalInsert = true;
  const store = new AsrSettingsStore(db as never);
  expect(() => store.initialize()).toThrow("simulated global settings write failure");
  expect(db.execCalls).toContain("BEGIN IMMEDIATE");
  expect(db.runCalls.some((sql) => sql.startsWith("INSERT INTO asr_profiles"))).toBe(true);
  expect(db.runCalls.some((sql) => sql.startsWith("INSERT INTO asr_global_settings"))).toBe(true);
  expect(db.execCalls).toContain("ROLLBACK");
  expect(db.profiles.size).toBe(0);
  expect(db.global).toBeUndefined();
});

test("creates, updates, lists and activates profiles without exposing or cross-copying API keys", () => {
  const db = new MemoryAsrDatabase();
  let decryptCount = 0;
  const store = new AsrSettingsStore(
    db as never,
    createCodec(() => decryptCount++),
  );
  store.initialize();
  const alpha = store.saveProfile({
    name: " Alpha ",
    endpoint: "https://alpha.example/v1",
    apiMode: "audio_transcriptions",
    model: "alpha-model",
    systemPrompt: "",
    apiKey: "alpha-secret",
  });
  const beta = store.saveProfile({
    name: "Beta",
    endpoint: "https://beta.example/v1",
    model: "beta-model",
    systemPrompt: "",
  });

  const listed = store.listProfiles();
  expect(JSON.stringify(listed)).not.toContain("alpha-secret");
  expect(listed.profiles.find((profile) => profile.id === alpha.id)?.hasApiKey).toBe(true);
  expect(listed.profiles.find((profile) => profile.id === beta.id)?.hasApiKey).toBe(false);
  expect(decryptCount).toBe(0);

  store.saveProfile({
    id: alpha.id,
    name: "Alpha",
    endpoint: "https://alpha.example/v2",
    model: "alpha-model-2",
    systemPrompt: "",
    apiKey: "",
  });
  expect(decryptCount).toBe(1);
  expect(store.getClientConfig(alpha.id)?.apiKey).toBe("alpha-secret");
  expect(store.getClientConfig(beta.id)).toBeUndefined();

  store.activateProfile(alpha.id);
  store.save({
    endpoint: "https://active.example/v1",
    model: "active-model",
    systemPrompt: "",
  });
  expect(store.get().profileId).toBe(alpha.id);
  expect(store.get().model).toBe("active-model");
  expect(store.getClientConfig(alpha.id)?.apiKey).toBe("alpha-secret");

  expect(() =>
    store.saveProfile({
      name: " alpha ",
      endpoint: "",
      model: ASR_MODEL,
      systemPrompt: "",
    }),
  ).toThrow("名称已存在");
});

test("saveProfile upserts when an explicit id does not exist locally (cloud pull)", () => {
  const db = new MemoryAsrDatabase();
  const store = new AsrSettingsStore(db as never, createCodec());
  store.initialize();
  const cloudId = "5605e042-97a3-41f1-ac97-8e3c22acf688";
  const synced = store.saveProfile({
    id: cloudId,
    name: "Cloud ASR",
    endpoint: "https://cloud.example/v1",
    apiMode: "audio_transcriptions",
    model: "cloud-model",
    systemPrompt: "from cloud",
  });
  expect(synced.id).toBe(cloudId);
  expect(store.listProfiles().profiles.some((profile) => profile.id === cloudId)).toBe(true);
  store.activateProfile(cloudId);
  expect(store.get().profileId).toBe(cloudId);
});

test("pins client config by profile ID and rejects invalid profile operations without fallback", () => {
  const db = new MemoryAsrDatabase();
  const store = new AsrSettingsStore(db as never, createCodec());
  store.initialize();
  store.save({
    endpoint: "https://default.example/v1",
    model: "default-model",
    systemPrompt: "",
    apiKey: "default-secret",
  });
  const second = store.saveProfile({
    name: "Second",
    endpoint: "https://second.example/v1",
    model: "second-model",
    systemPrompt: "",
    apiKey: "second-secret",
  });

  expect(store.getClientConfig()?.model).toBe("default-model");
  expect(store.getClientConfig(second.id)?.model).toBe("second-model");
  expect(() => store.getClientConfig("11111111-1111-4111-8111-111111111111")).toThrow("ASR profile 不存在");
  expect(() => store.getClientConfig("not-a-uuid")).toThrow("有效 UUID");
});

test("returns the real active profile identity in status without decrypting or exposing its key", () => {
  const db = new MemoryAsrDatabase();
  let decryptCount = 0;
  const store = new AsrSettingsStore(
    db as never,
    createCodec(() => decryptCount++),
  );
  store.initialize();
  const second = store.saveProfile({
    name: "Mobile recording",
    endpoint: "https://mobile.example/v1",
    model: "mobile-model",
    systemPrompt: "",
    apiKey: "mobile-secret",
  });
  store.activateProfile(second.id);

  const status = store.getStatus();
  expect(status).toEqual({
    activeProfileId: second.id,
    activeProfileName: "Mobile recording",
    hasApiKey: true,
    apiKeyEncryptionAvailable: true,
    model: "mobile-model",
  });
  expect(JSON.stringify(status)).not.toContain("mobile-secret");
  expect(decryptCount).toBe(0);
});

test("does not decrypt a damaged non-active key while listing or reading active client config", () => {
  const db = new MemoryAsrDatabase();
  let decryptCount = 0;
  const store = new AsrSettingsStore(
    db as never,
    createCodec(() => decryptCount++),
  );
  store.initialize();
  store.save({
    endpoint: "https://active.example/v1",
    model: "active-model",
    systemPrompt: "",
    apiKey: "active-secret",
  });
  const damaged = store.saveProfile({
    name: "Damaged",
    endpoint: "https://damaged.example/v1",
    model: "damaged-model",
    systemPrompt: "",
    apiKey: "temporary-secret",
  });
  const damagedRow = db.profiles.get(damaged.id);
  if (!damagedRow) throw new Error("Damaged profile fixture was not created.");
  damagedRow.encrypted_api_key = "invalid-ciphertext";

  const listed = store.listProfiles();
  expect(listed.profiles.find((profile) => profile.id === damaged.id)?.hasApiKey).toBe(true);
  expect(decryptCount).toBe(0);
  expect(store.getClientConfig()).toEqual({
    endpoint: "https://active.example/v1",
    apiMode: "chat_completions",
    model: "active-model",
    systemPrompt: "",
    apiKey: "active-secret",
  });
  expect(decryptCount).toBe(1);
  expect(() => store.getClientConfig(damaged.id)).toThrow("解密失败");
});

test("persists global input device and enforces active/last-profile deletion constraints", () => {
  const db = new MemoryAsrDatabase();
  const store = new AsrSettingsStore(db as never);
  store.initialize();
  const second = store.saveProfile({
    name: "Second",
    endpoint: "",
    model: ASR_MODEL,
    systemPrompt: "",
  });

  expect(() => store.deleteProfile(DEFAULT_ASR_PROFILE_ID)).toThrow("不能删除当前 active");
  store.activateProfile(second.id);
  expect(() => store.deleteProfile(second.id)).toThrow("不能删除当前 active");
  store.deleteProfile(DEFAULT_ASR_PROFILE_ID);
  expect(store.listProfiles().profiles).toHaveLength(1);
  expect(() => store.deleteProfile(second.id)).toThrow("不能删除当前 active");

  expect(store.saveInputDevice({ inputDeviceId: " microphone-1 " }).inputDeviceId).toBe("microphone-1");
  expect(store.get().inputDeviceId).toBe("microphone-1");
  expect(store.saveInputDevice({ inputDeviceId: "" }).inputDeviceId).toBeUndefined();
});

test("validates profile names, model values and IDs explicitly", () => {
  const db = new MemoryAsrDatabase();
  const store = new AsrSettingsStore(db as never);
  store.initialize();
  expect(() => store.saveProfile({ name: " ", endpoint: "", model: ASR_MODEL, systemPrompt: "" })).toThrow(
    "名称不能为空",
  );
  expect(() =>
    store.saveProfile({ name: "x".repeat(81), endpoint: "", model: ASR_MODEL, systemPrompt: "" }),
  ).toThrow("名称不能超过 80");
  expect(() => store.saveProfile({ name: "Valid", endpoint: "", model: " ", systemPrompt: "" })).toThrow(
    "ASR 模型不能为空",
  );
  expect(() =>
    store.saveProfile({
      id: "not-a-uuid",
      name: "Valid",
      endpoint: "",
      model: ASR_MODEL,
      systemPrompt: "",
    }),
  ).toThrow("有效 UUID");
});

test("registers profile IPC locally without exposing new profile mutations as remote commands", () => {
  for (const channel of [
    IPC_CHANNELS.asrProfilesList,
    IPC_CHANNELS.asrProfileSave,
    IPC_CHANNELS.asrProfileDelete,
    IPC_CHANNELS.asrProfileActivate,
    IPC_CHANNELS.asrInputDeviceSave,
  ]) {
    expect(isKnownIpcChannel(channel)).toBe(true);
    expect(isRemoteCommandChannel(channel)).toBe(false);
  }
  expect(isRemoteCommandChannel(IPC_CHANNELS.asrSettingsGetStatus)).toBe(true);
  expect(isRemoteCommandChannel(IPC_CHANNELS.asrSettingsGetClientConfig)).toBe(false);
  expect(isRemoteCommandChannel(IPC_CHANNELS.asrTranscribe)).toBe(true);
});
