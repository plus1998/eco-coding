import { expect, test } from "bun:test";
import {
  FULL_ACCESS_NOTICE_STORAGE_KEY,
  persistFullAccessNoticeHidden,
  readFullAccessNoticeHidden,
} from "../src/renderer/full-access-notice-preferences";

test("full access notice preference defaults to visible", () => {
  expect(readFullAccessNoticeHidden({ getItem: () => null })).toBe(false);
});

test("full access notice preference reads and persists permanent dismissal", () => {
  const values = new Map<string, string>([[FULL_ACCESS_NOTICE_STORAGE_KEY, "true"]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };

  expect(readFullAccessNoticeHidden(storage)).toBe(true);
  persistFullAccessNoticeHidden(false, storage);
  expect(values.get(FULL_ACCESS_NOTICE_STORAGE_KEY)).toBe("false");
  expect(readFullAccessNoticeHidden(storage)).toBe(false);
});
