import { expect, test } from "bun:test";
import {
  buildCenterServerWebSocketUrl,
  normalizeCenterServerHttpUrl,
  validateCenterServerSettingsInput,
} from "../src/shared/center-server";

test("normalizeCenterServerHttpUrl trims trailing slashes", () => {
  expect(normalizeCenterServerHttpUrl("https://center.example.com/api/")).toBe("https://center.example.com/api");
});

test("buildCenterServerWebSocketUrl maps http to ws and appends access token", () => {
  const url = buildCenterServerWebSocketUrl("http://127.0.0.1:8787", "token_abc");
  expect(url).toBe("ws://127.0.0.1:8787/v1/rpc?access_token=token_abc");
});

test("validateCenterServerSettingsInput requires URL when enabled", () => {
  expect(() => validateCenterServerSettingsInput({ enabled: true, serverUrl: "" })).toThrow(
    /Center server URL is required/,
  );
});
