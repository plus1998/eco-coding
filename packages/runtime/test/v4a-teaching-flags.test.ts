import { expect, test } from "bun:test";
import { isV4aTeachingEnabled } from "../src/v4a-teaching-flags.js";

test("isV4aTeachingEnabled defaults false and reads legacy v4aCorrectionEnabled", () => {
  expect(isV4aTeachingEnabled(undefined)).toBe(false);
  expect(isV4aTeachingEnabled({})).toBe(false);
  expect(isV4aTeachingEnabled({ v4aTeachingEnabled: true })).toBe(true);
  expect(isV4aTeachingEnabled({ v4aCorrectionEnabled: true })).toBe(true);
});
