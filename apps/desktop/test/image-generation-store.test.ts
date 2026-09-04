import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type ImageGenerationSecretCodec, ImageGenerationStore } from "../src/main/image-generation-store";

const temporaryDirectories: string[] = [];
const openDatabases: Database[] = [];

afterEach(async () => {
  for (const database of openDatabases.splice(0)) {
    try {
      database.close();
    } catch {
      // Ignore already-closed handles on Windows.
    }
  }
  for (const directory of temporaryDirectories.splice(0)) {
    try {
      await fs.rm(directory, { recursive: true, force: true });
    } catch {
      // Windows may keep the sqlite file locked briefly after close.
    }
  }
});

const codec: ImageGenerationSecretCodec = {
  isAvailable: () => true,
  encrypt: (value) => `encrypted:${Buffer.from(value).toString("base64")}`,
  decrypt: (value) => Buffer.from(value.slice("encrypted:".length), "base64").toString(),
};

async function createStore() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eco-image-store-"));
  temporaryDirectories.push(directory);
  const database = new Database(path.join(directory, "settings.sqlite"));
  openDatabases.push(database);
  const store = new ImageGenerationStore(database as never, codec);
  store.initialize();
  return store;
}

test("new OpenAI image profiles use gpt-image-2", async () => {
  const store = await createStore();
  expect(store.getSettings().profiles[0]?.model).toBe("gpt-image-2");
  expect(store.getSettings().profiles[0]?.supportsImageToImage).toBe(true);
});

test("the built-in legacy OpenAI profile is migrated without changing custom profiles", async () => {
  const store = await createStore();
  const builtIn = store.getSettings().profiles[0]!;
  store.saveProfile({
    id: builtIn.id,
    name: builtIn.name,
    provider: builtIn.provider,
    endpoint: builtIn.endpoint,
    model: "gpt-image-1",
    supportsImageToImage: builtIn.supportsImageToImage,
  });
  const custom = store.saveProfile({
    name: "Custom legacy model",
    provider: "openai",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-image-1",
    supportsImageToImage: false,
  });

  store.initialize();

  expect(store.getSettings().profiles.find((profile) => profile.id === builtIn.id)?.model).toBe(
    "gpt-image-2",
  );
  expect(store.getSettings().profiles.find((profile) => profile.id === custom.id)?.model).toBe("gpt-image-1");
  expect(store.getSettings().profiles.find((profile) => profile.id === custom.id)?.supportsImageToImage).toBe(
    false,
  );
});

test("image generation profiles keep one active config and do not expose API keys", async () => {
  const store = await createStore();
  const initial = store.getSettings();
  const defaultProfile = initial.profiles[0]!;
  store.saveProfile({
    id: defaultProfile.id,
    name: "OpenAI primary",
    provider: "openai",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-image-1",
    supportsImageToImage: true,
    apiKey: "secret-openai",
  });
  const gemini = store.saveProfile({
    name: "Gemini",
    provider: "gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-flash-image",
    supportsImageToImage: true,
    apiKey: "secret-gemini",
  });

  store.activateProfile(gemini.id);
  store.setEnabled(true);
  const snapshot = store.getSettings();
  expect(snapshot.activeProfileId).toBe(gemini.id);
  expect(snapshot.profiles.every((profile) => profile.hasApiKey)).toBe(true);
  expect(JSON.stringify(snapshot)).not.toContain("secret-");
  expect(store.getActiveClientConfig()).toMatchObject({
    profileId: gemini.id,
    provider: "gemini",
    model: "gemini-2.5-flash-image",
    apiKey: "secret-gemini",
    supportsImageToImage: true,
  });
});

test("openai_compatible profiles default image-to-image off; OpenAI/Gemini default on", async () => {
  const store = await createStore();
  const compatible = store.saveProfile({
    name: "Local compatible",
    provider: "openai_compatible",
    endpoint: "http://example.com/v1",
    model: "image-model",
    apiKey: "key",
  });
  const openai = store.saveProfile({
    name: "Official OpenAI",
    provider: "openai",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-image-2",
    apiKey: "key",
  });
  expect(compatible.supportsImageToImage).toBe(false);
  expect(openai.supportsImageToImage).toBe(true);
});

test("cloud sync can activate and enable a profile before API key arrives", async () => {
  const store = await createStore();
  const cloudId = "5605e042-97a3-41f1-ac97-8e3c22acf688";
  store.saveProfile({
    id: cloudId,
    name: "GPT-image-2",
    provider: "openai",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-image-1",
    supportsImageToImage: true,
  });
  expect(() => store.setEnabled(true)).toThrow("尚未配置 API Key");
  store.activateProfile(cloudId, { skipApiKeyCheck: true });
  store.setEnabled(true, { skipApiKeyCheck: true });
  expect(store.getSettings()).toMatchObject({
    enabled: true,
    activeProfileId: cloudId,
  });
});

test("image generation artifacts preserve tool id, parameters, success, and failure", async () => {
  const store = await createStore();
  const profile = store.getSettings().profiles[0]!;
  store.saveProfile({
    id: profile.id,
    name: profile.name,
    provider: "openai",
    endpoint: profile.endpoint,
    model: profile.model,
    supportsImageToImage: true,
    apiKey: "key",
  });
  const config = store.getActiveClientConfig();
  const running = store.createArtifact({
    threadId: "thread-1",
    toolUseId: "tool-1",
    prompt: "Draw a precise red square",
    parameters: { size: "1024x1024", count: 1 },
    config,
    workspacePath: "/workspace",
    generationRoot: "/workspace/worktree",
  });
  expect(running).toMatchObject({
    status: "running",
    toolUseId: "tool-1",
    parameters: { size: "1024x1024", count: 1 },
  });

  const completed = store.completeArtifact(running.id, [
    {
      absolutePath: "/workspace/worktree/.eco/generated-images/thread-1/a.png",
      relativePath: ".eco/generated-images/thread-1/a.png",
      mimeType: "image/png",
      bytes: 12,
    },
  ]);
  expect(completed.status).toBe("completed");
  expect(completed.images).toHaveLength(1);

  const failedArtifact = store.createArtifact({
    threadId: "thread-1",
    prompt: "Second image",
    parameters: {},
    config,
    workspacePath: "/workspace",
    generationRoot: "/workspace",
  });
  const failed = store.failArtifact(failedArtifact.id, "rate_limited", "quota exceeded");
  expect(failed).toMatchObject({
    status: "failed",
    errorCode: "rate_limited",
    errorMessage: "quota exceeded",
  });
  expect(store.listArtifacts("thread-1")).toHaveLength(2);
});

test("OpenAI-compatible profiles accept HTTP endpoints", async () => {
  const store = await createStore();
  const profile = store.saveProfile({
    name: "Local compatible",
    provider: "openai_compatible",
    endpoint: "http://example.com/v1",
    model: "image-model",
    apiKey: "key",
  });
  expect(profile.endpoint).toBe("http://example.com/v1");
  expect(profile.supportsImageToImage).toBe(false);
});

test("legacy databases without supports_image_to_image migrate to false", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eco-image-store-legacy-"));
  temporaryDirectories.push(directory);
  const seed = new Database(path.join(directory, "settings.sqlite"));
  seed.exec(`
    CREATE TABLE image_generation_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      provider TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      model TEXT NOT NULL,
      encrypted_api_key TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE image_generation_settings (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
      active_profile_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const now = new Date().toISOString();
  seed
    .prepare(
      `INSERT INTO image_generation_profiles
     (id, name, provider, endpoint, model, encrypted_api_key, created_at, updated_at)
     VALUES (?, ?, 'openai', 'https://api.openai.com/v1', 'gpt-image-2', '', ?, ?)`,
    )
    .run("00000000-0000-4000-8000-000000000002", "Legacy", now, now);
  seed
    .prepare(
      `INSERT INTO image_generation_settings (singleton, enabled, active_profile_id, updated_at)
     VALUES (1, 0, ?, ?)`,
    )
    .run("00000000-0000-4000-8000-000000000002", now);
  seed.close();

  const database = new Database(path.join(directory, "settings.sqlite"));
  openDatabases.push(database);
  const store = new ImageGenerationStore(database as never, codec);
  store.initialize();
  expect(store.getSettings().profiles[0]?.supportsImageToImage).toBe(false);
});
