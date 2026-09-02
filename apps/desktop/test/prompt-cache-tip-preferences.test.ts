import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_PROMPT_CACHE_TIP_PREFERENCES,
  normalizePromptCacheTipPreferences,
  PROMPT_CACHE_TIP_STORAGE_KEY,
  persistPromptCacheTipPreferences,
  readStoredPromptCacheTipPreferences,
} from "../src/renderer/prompt-cache-tip-preferences";

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("prompt cache tip preferences", () => {
  test("defaults to enabled", () => {
    expect(readStoredPromptCacheTipPreferences()).toEqual({ enabled: true });
    expect(readStoredPromptCacheTipPreferences()).toEqual(DEFAULT_PROMPT_CACHE_TIP_PREFERENCES);
  });

  test("restores a valid stored preference", () => {
    storage.set(PROMPT_CACHE_TIP_STORAGE_KEY, JSON.stringify({ enabled: false }));
    expect(readStoredPromptCacheTipPreferences()).toEqual({ enabled: false });
  });

  test("normalizes invalid values to default enabled", () => {
    expect(normalizePromptCacheTipPreferences({ enabled: "yes" })).toEqual(
      DEFAULT_PROMPT_CACHE_TIP_PREFERENCES,
    );
    expect(normalizePromptCacheTipPreferences(null)).toEqual(DEFAULT_PROMPT_CACHE_TIP_PREFERENCES);
    expect(normalizePromptCacheTipPreferences({ enabled: true })).toEqual({ enabled: true });
    expect(normalizePromptCacheTipPreferences({ enabled: false })).toEqual({ enabled: false });
  });

  test("returns defaults for malformed storage", () => {
    storage.set(PROMPT_CACHE_TIP_STORAGE_KEY, "not-json");
    expect(readStoredPromptCacheTipPreferences()).toEqual(DEFAULT_PROMPT_CACHE_TIP_PREFERENCES);
  });

  test("persist writes normalized preferences", () => {
    persistPromptCacheTipPreferences({ enabled: false });
    expect(storage.get(PROMPT_CACHE_TIP_STORAGE_KEY)).toBe(JSON.stringify({ enabled: false }));
    expect(readStoredPromptCacheTipPreferences()).toEqual({ enabled: false });
  });
});
