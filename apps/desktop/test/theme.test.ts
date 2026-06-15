import { describe, expect, test } from "bun:test";
import { isAppTheme, readStoredAppTheme } from "../src/renderer/theme";

describe("theme", () => {
  test("isAppTheme accepts dark and light only", () => {
    expect(isAppTheme("dark")).toBe(true);
    expect(isAppTheme("light")).toBe(true);
    expect(isAppTheme("system")).toBe(false);
    expect(isAppTheme(null)).toBe(false);
  });

  test("readStoredAppTheme falls back to dark", () => {
    const storage = new Map<string, string>();
    const previous = globalThis.localStorage;

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
      },
    });

    try {
      expect(readStoredAppTheme()).toBe("dark");

      storage.set("eco.app-theme", "light");
      expect(readStoredAppTheme()).toBe("light");

      storage.set("eco.app-theme", "invalid");
      expect(readStoredAppTheme()).toBe("dark");
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previous,
      });
    }
  });
});
