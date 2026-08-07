import { expect, test } from "bun:test";
import type { ProviderConfigInput } from "../src/shared/ipc";
import {
  FREE_TOKEN_PROVIDER_PRESETS,
  applyProviderPreset,
  findMatchingProviderPreset,
  formatProviderPresetSelectLabel,
} from "../src/renderer/provider-presets";

test("free token provider presets are valid service roots", () => {
  expect(FREE_TOKEN_PROVIDER_PRESETS.length).toBeGreaterThanOrEqual(2);

  const ids = new Set<string>();
  for (const preset of FREE_TOKEN_PROVIDER_PRESETS) {
    expect(ids.has(preset.id)).toBe(false);
    ids.add(preset.id);

    expect(preset.name.trim()).not.toBe("");
    expect(preset.defaultModel.trim()).not.toBe("");
    expect(preset.apiKeyUrl).toMatch(/^https:\/\//);
    expect(preset.baseUrl).toMatch(/^https:\/\//);
    expect(preset.baseUrl).not.toMatch(/\/v1\/?$/);
    expect(preset.requestPath === "" || preset.requestPath.startsWith("/")).toBe(true);
    expect(preset.apiCompat).toBe("openai_chat_completions");
  }
});

test("applying a provider preset keeps edit identity and entered api key", () => {
  const form: ProviderConfigInput = {
    id: "provider_existing",
    name: "Custom",
    baseUrl: "https://example.test",
    requestPath: "",
    version: "v1",
    apiCompat: "anthropic",
    apiKey: "already-entered",
    defaultModel: "old-model",
    enabled: false,
  };

  const preset = FREE_TOKEN_PROVIDER_PRESETS[0]!;
  const next = applyProviderPreset(form, preset);

  expect(next.id).toBe(form.id);
  expect(next.apiKey).toBe(form.apiKey);
  expect(next.name).toBe(preset.name);
  expect(next.baseUrl).toBe(preset.baseUrl);
  expect(next.requestPath).toBe(preset.requestPath);
  expect(next.apiCompat).toBe(preset.apiCompat);
  expect(next.defaultModel).toBe(preset.defaultModel);
  expect(next.enabled).toBe(true);
});

test("matching provider preset tolerates slash normalization", () => {
  const preset = FREE_TOKEN_PROVIDER_PRESETS.find((entry) => entry.id === "opencode-zen-free");
  expect(preset).toBeDefined();

  const match = findMatchingProviderPreset({
    baseUrl: `${preset!.baseUrl}/`,
    requestPath: "zen/",
    version: "v1",
    apiCompat: preset!.apiCompat,
    defaultModel: preset!.defaultModel,
  });

  expect(match?.id).toBe(preset!.id);
});

test("provider preset select labels show free badge without model ids", () => {
  const preset = FREE_TOKEN_PROVIDER_PRESETS.find((entry) => entry.id === "opencode-zen-free");
  expect(preset).toBeDefined();

  const label = formatProviderPresetSelectLabel(preset!);
  expect(label).toBe("OpenCode Zen · Free");
  expect(label).not.toContain(preset!.defaultModel);
});


test("matching provider preset ignores default model differences", () => {
  const preset = FREE_TOKEN_PROVIDER_PRESETS.find((entry) => entry.id === "opencode-zen-free");
  expect(preset).toBeDefined();

  const match = findMatchingProviderPreset({
    baseUrl: preset!.baseUrl,
    requestPath: preset!.requestPath,
    version: "v1",
    apiCompat: preset!.apiCompat,
    defaultModel: "some-other-model",
  });

  expect(match?.id).toBe(preset!.id);
});
