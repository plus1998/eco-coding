import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_TYPOGRAPHY_PREFERENCES,
  normalizeTypographyPreferences,
  readStoredTypographyPreferences,
  TYPOGRAPHY_STORAGE_KEY,
} from "../src/renderer/typography-preferences";

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

describe("typography preferences", () => {
  test("uses Codex Desktop inspired defaults", () => {
    expect(readStoredTypographyPreferences()).toEqual({ uiFontSize: 14, codeFontSize: 12 });
    expect(readStoredTypographyPreferences()).toEqual(DEFAULT_TYPOGRAPHY_PREFERENCES);
  });

  test("restores a valid stored preference", () => {
    storage.set(TYPOGRAPHY_STORAGE_KEY, JSON.stringify({ uiFontSize: 16, codeFontSize: 13 }));
    expect(readStoredTypographyPreferences()).toEqual({ uiFontSize: 16, codeFontSize: 13 });
  });

  test("normalizes invalid and out-of-range values", () => {
    expect(normalizeTypographyPreferences({ uiFontSize: 99, codeFontSize: 1 })).toEqual({
      uiFontSize: 16,
      codeFontSize: 8,
    });
    expect(normalizeTypographyPreferences({ uiFontSize: 1, codeFontSize: 99 })).toEqual({
      uiFontSize: 11,
      codeFontSize: 24,
    });
    expect(normalizeTypographyPreferences({ uiFontSize: "16", codeFontSize: Number.NaN })).toEqual(
      DEFAULT_TYPOGRAPHY_PREFERENCES,
    );
  });

  test("returns defaults for malformed storage", () => {
    storage.set(TYPOGRAPHY_STORAGE_KEY, "not-json");
    expect(readStoredTypographyPreferences()).toEqual(DEFAULT_TYPOGRAPHY_PREFERENCES);
  });
});
