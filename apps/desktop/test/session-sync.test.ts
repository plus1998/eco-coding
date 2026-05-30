import { expect, test } from "bun:test";
import { previewSecret, validateSessionSyncInput } from "../src/shared/session-sync";

test("validateSessionSyncInput requires redis url when enabled", () => {
  expect(() =>
    validateSessionSyncInput({
      redisEnabled: true,
      redisUrl: "",
      keyPrefix: "eco-sessions",
    }),
  ).toThrow("Redis URL is required");
});

test("validateSessionSyncInput accepts disabled config without url", () => {
  expect(() =>
    validateSessionSyncInput({
      redisEnabled: false,
      redisUrl: "",
      keyPrefix: "eco-sessions",
    }),
  ).not.toThrow();
});

test("previewSecret masks stored password", () => {
  expect(previewSecret("")).toBeUndefined();
  expect(previewSecret("abcd")).toBe("••••");
  expect(previewSecret("secret-token")).toBe("se••••en");
});
