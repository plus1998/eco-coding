import { describe, expect, test } from "bun:test";
import {
  isAppTheme,
  readStoredAppTheme,
  readSystemAppTheme,
  resolveAppTheme,
} from "../src/renderer/theme";

describe("theme", () => {
  test("isAppTheme accepts dark, light, and system", () => {
    expect(isAppTheme("dark")).toBe(true);
    expect(isAppTheme("light")).toBe(true);
    expect(isAppTheme("system")).toBe(true);
    expect(isAppTheme("auto")).toBe(false);
    expect(isAppTheme(null)).toBe(false);
  });

  test("resolveAppTheme maps system to current OS preference", () => {
    const previous = globalThis.matchMedia;

    Object.defineProperty(globalThis, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query.includes("dark"),
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });

    try {
      expect(resolveAppTheme("dark")).toBe("dark");
      expect(resolveAppTheme("light")).toBe("light");
      expect(resolveAppTheme("system")).toBe("dark");
      expect(readSystemAppTheme()).toBe("dark");
    } finally {
      Object.defineProperty(globalThis, "matchMedia", {
        configurable: true,
        value: previous,
      });
    }
  });

  test("readStoredAppTheme defaults to system", () => {
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
      expect(readStoredAppTheme()).toBe("system");

      storage.set("eco.app-theme", "light");
      expect(readStoredAppTheme()).toBe("light");

      storage.set("eco.app-theme", "invalid");
      expect(readStoredAppTheme()).toBe("system");
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previous,
      });
    }
  });
});
