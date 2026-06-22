import { expect, test } from "bun:test";
import {
  buildCenterServerWebSocketUrl,
  CENTER_SERVER_REAUTH_MESSAGE,
  isCenterServerAuthCredentialError,
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

test("isCenterServerAuthCredentialError detects refresh token failures", () => {
  expect(isCenterServerAuthCredentialError("Refresh token is invalid or expired.")).toBe(true);
  expect(isCenterServerAuthCredentialError("Device credentials are invalid.")).toBe(true);
  expect(isCenterServerAuthCredentialError(CENTER_SERVER_REAUTH_MESSAGE)).toBe(true);
  expect(isCenterServerAuthCredentialError("Connection timed out.")).toBe(false);
});
