import { expect, test } from "bun:test";
import {
  DEFAULT_DEV_USER_DATA_SUFFIX,
  resolveDevUserDataSuffix,
} from "../src/main/desktop-dev-user-data-suffix";

test("resolveDevUserDataSuffix falls back to Dev", () => {
  expect(resolveDevUserDataSuffix()).toBe(DEFAULT_DEV_USER_DATA_SUFFIX);
  expect(resolveDevUserDataSuffix("")).toBe(DEFAULT_DEV_USER_DATA_SUFFIX);
  expect(resolveDevUserDataSuffix("   ")).toBe(DEFAULT_DEV_USER_DATA_SUFFIX);
});

test("resolveDevUserDataSuffix accepts a single path component", () => {
  expect(resolveDevUserDataSuffix("DevQuito")).toBe("DevQuito");
  expect(resolveDevUserDataSuffix("  DevTwo  ")).toBe("DevTwo");
});

test("resolveDevUserDataSuffix rejects unsafe suffix values", () => {
  for (const suffix of ["../Dev", "Dev/Two", "Dev:1", "Dev.", "bad|name"]) {
    expect(() => resolveDevUserDataSuffix(suffix)).toThrow(/ECO_DEV_USER_DATA_SUFFIX/);
  }
});
