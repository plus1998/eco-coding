import { expect, test } from "bun:test";
import {
  buildCenterServerWebSocketUrl,
  buildEcoAuthEmailConfirmRedirect,
  CENTER_SERVER_INCOMPLETE_CONFIG_MESSAGE,
  CENTER_SERVER_REAUTH_MESSAGE,
  classifyCenterServerAuthError,
  isCenterServerAuthCredentialError,
  normalizeCenterServerHttpUrl,
  parseEcoConnectDeepLink,
  recoveryForSessionRefreshFailure,
  validateCenterServerSettingsInput,
} from "../src/shared/center-server";

test("buildEcoAuthEmailConfirmRedirect points at project Edge Function", () => {
  expect(buildEcoAuthEmailConfirmRedirect("https://abc.supabase.co/")).toBe(
    "https://abc.supabase.co/functions/v1/auth-email-confirmed",
  );
});

test("normalizeCenterServerHttpUrl trims trailing slashes", () => {
  expect(normalizeCenterServerHttpUrl("https://center.example.com/api/")).toBe(
    "https://center.example.com/api",
  );
});

test("buildCenterServerWebSocketUrl maps http to ws and appends access token", () => {
  const url = buildCenterServerWebSocketUrl("http://127.0.0.1:8787", "token_abc");
  expect(url).toBe("ws://127.0.0.1:8787/v1/rpc?access_token=token_abc");
});

test("validateCenterServerSettingsInput requires URL when enabled", () => {
  expect(() => validateCenterServerSettingsInput({ enabled: true, supabaseUrl: "" })).toThrow(
    /Supabase project URL is required/,
  );
});

const authRecoveryCases: Array<[string, ReturnType<typeof classifyCenterServerAuthError>]> = [
  ["Refresh token is invalid or expired.", "relogin"],
  ["Invalid Refresh Token", "relogin"],
  ["refresh_token_not_found", "relogin"],
  ["Device credentials are invalid.", "relogin"],
  [CENTER_SERVER_REAUTH_MESSAGE, "relogin"],
  [CENTER_SERVER_INCOMPLETE_CONFIG_MESSAGE, "relogin"],
  ["Device is not active.", "device_inactive"],
  ["Token device is not active.", "device_inactive"],
  ["Refresh token device is not active.", "device_inactive"],
  ["Token user is not active.", "account_unusable"],
  ["Refresh token subject is not active.", "account_unusable"],
  ["Connection timed out.", "network"],
  ["Request failed with HTTP 503.", "network"],
  ["SocketException: Failed host lookup", "network"],
  ["Something else", "unknown"],
  ["Unauthorized", "unknown"],
  ["not authorized", "unknown"],
  ["Auth session missing!", "network"],
  ["user session expired", "relogin"],
];

test.each(authRecoveryCases)("classifyCenterServerAuthError(%s)", (message, expected) => {
  expect(classifyCenterServerAuthError(message)).toBe(expected);
});

test("isCenterServerAuthCredentialError detects refresh token failures", () => {
  expect(isCenterServerAuthCredentialError("Refresh token is invalid or expired.")).toBe(true);
  expect(isCenterServerAuthCredentialError("Device credentials are invalid.")).toBe(true);
  expect(isCenterServerAuthCredentialError(CENTER_SERVER_REAUTH_MESSAGE)).toBe(true);
  expect(isCenterServerAuthCredentialError("Connection timed out.")).toBe(false);
  expect(isCenterServerAuthCredentialError("Unauthorized")).toBe(false);
});

test("recoveryForSessionRefreshFailure keeps session on transient failures", () => {
  expect(recoveryForSessionRefreshFailure("SocketException: Failed host lookup")).toBe("network");
  expect(recoveryForSessionRefreshFailure("Unauthorized")).toBe("network");
  expect(recoveryForSessionRefreshFailure("Something ambiguous")).toBe("network");
  expect(recoveryForSessionRefreshFailure("Refresh token is invalid or expired.")).toBe("relogin");
});

test("parseEcoConnectDeepLink parses eco://connect with url + token", () => {
  const parsed = parseEcoConnectDeepLink(
    "eco://connect?url=https://abc.supabase.co&token=your.anon.key",
  );
  expect(parsed).toEqual({ supabaseUrl: "https://abc.supabase.co", anonKey: "your.anon.key" });
});

test("parseEcoConnectDeepLink accepts supabase/anon aliases and normalizes URLs", () => {
  const parsed = parseEcoConnectDeepLink("eco://connect?supabase=https://abc.supabase.co/&anon=key123");
  expect(parsed).toEqual({ supabaseUrl: "https://abc.supabase.co", anonKey: "key123" });
});

test("parseEcoConnectDeepLink rejects non-eco schemes and other hosts", () => {
  expect(parseEcoConnectDeepLink("https://connect?url=x&token=y")).toBeUndefined();
  expect(parseEcoConnectDeepLink("eco://center?supabase=x&anon=y")).toBeUndefined();
  expect(parseEcoConnectDeepLink("garbage")).toBeUndefined();
});

test("parseEcoConnectDeepLink keeps empty fields for missing/invalid params", () => {
  expect(parseEcoConnectDeepLink("eco://connect")).toEqual({ supabaseUrl: "", anonKey: "" });
  expect(parseEcoConnectDeepLink("eco://connect?url=not-a-url&token=k")).toEqual({
    supabaseUrl: "",
    anonKey: "k",
  });
});
