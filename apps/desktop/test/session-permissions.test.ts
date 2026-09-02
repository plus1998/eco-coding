import { expect, test } from "bun:test";
import { isAllowedSessionPermission, isLocalRendererUrl } from "../src/main/session-permissions";

test("isLocalRendererUrl accepts file and localhost", () => {
  expect(isLocalRendererUrl("file:///Users/x/app/index.html")).toBe(true);
  expect(isLocalRendererUrl("http://localhost:5173/")).toBe(true);
  expect(isLocalRendererUrl("http://127.0.0.1:5173/")).toBe(true);
  expect(isLocalRendererUrl("https://example.com/")).toBe(false);
});

test("isAllowedSessionPermission allows local clipboard write", () => {
  expect(isAllowedSessionPermission(true, "clipboard-sanitized-write")).toBe(true);
  expect(isAllowedSessionPermission(false, "clipboard-sanitized-write")).toBe(false);
  // Clipboard read stays denied until a feature needs it.
  expect(isAllowedSessionPermission(true, "clipboard-read")).toBe(false);
});

test("isAllowedSessionPermission allows local audio-only media", () => {
  expect(isAllowedSessionPermission(true, "media", ["audio"])).toBe(true);
  expect(isAllowedSessionPermission(true, "media", ["audio", "video"])).toBe(false);
  expect(isAllowedSessionPermission(true, "media", ["video"])).toBe(false);
  expect(isAllowedSessionPermission(true, "geolocation")).toBe(false);
});
