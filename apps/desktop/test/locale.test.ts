import { expect, test } from "bun:test";
import {
  APP_LOCALE_STORAGE_KEY,
  normalizeLocalePreference,
  persistLocalePreference,
  readStoredLocalePreference,
  resolveAppLocale,
} from "../src/shared/locale";

test("locale preference normalization and system resolution are deterministic", () => {
  expect(normalizeLocalePreference("zh-CN")).toBe("zh-CN");
  expect(normalizeLocalePreference("en-US")).toBe("en-US");
  expect(normalizeLocalePreference("fr-FR")).toBe("system");
  expect(resolveAppLocale("system", ["zh-Hans-CN", "en-US"])).toBe("zh-CN");
  expect(resolveAppLocale("system", ["en-GB"])).toBe("en-US");
  expect(resolveAppLocale("zh-CN", ["en-US"])).toBe("zh-CN");
});

test("locale preference storage reads, writes, and tolerates failures", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  expect(readStoredLocalePreference(storage)).toBe("system");
  persistLocalePreference("en-US", storage);
  expect(values.get(APP_LOCALE_STORAGE_KEY)).toBe("en-US");
  expect(readStoredLocalePreference(storage)).toBe("en-US");
  expect(
    readStoredLocalePreference({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
    }),
  ).toBe("system");
});
