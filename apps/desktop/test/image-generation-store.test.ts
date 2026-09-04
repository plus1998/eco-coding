import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type ImageGenerationSecretCodec, ImageGenerationStore } from "../src/main/image-generation-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

const codec: ImageGenerationSecretCodec = {
  isAvailable: () => true,
  encrypt: (value) => `encrypted:${Buffer.from(value).toString("base64")}`,
  decrypt: (value) => Buffer.from(value.slice("encrypted:".length), "base64").toString(),
};

async function createStore() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eco-image-store-"));
  temporaryDirectories.push(directory);
  const store = new ImageGenerationStore(
    new Database(path.join(directory, "settings.sqlite")) as never,
    codec,
  );
  store.initialize();
  return store;
}

test("new OpenAI image profiles use gpt-image-2", async () => {
  const store = await createStore();
  expect(store.getSettings().profiles[0]?.model).toBe("gpt-image-2");
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
  });
  const custom = store.saveProfile({
    name: "Custom legacy model",
    provider: "openai",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-image-1",
  });

  store.initialize();

  expect(store.getSettings().profiles.find((profile) => profile.id === builtIn.id)?.model).toBe(
    "gpt-image-2",
  );
  expect(store.getSettings().profiles.find((profile) => profile.id === custom.id)?.model).toBe("gpt-image-1");
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
    apiKey: "secret-openai",
  });
  const gemini = store.saveProfile({
    name: "Gemini",
    provider: "gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-flash-image",
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
  });
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
});
