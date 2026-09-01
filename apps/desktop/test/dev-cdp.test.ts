import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  DEFAULT_DEV_CDP_PORT,
  FORBIDDEN_CDP_PORT,
  isDevCdpEnabled,
  isDevRuntime,
  resolveDevRemoteDebuggingPort,
} from "../src/shared/dev-cdp";

const envSnapshot = { ...process.env };

beforeEach(() => {
  process.env = { ...envSnapshot };
});

afterEach(() => {
  process.env = { ...envSnapshot };
});

test("FORBIDDEN_CDP_PORT is 9222", () => {
  expect(FORBIDDEN_CDP_PORT).toBe(9222);
});

test("DEFAULT_DEV_CDP_PORT is 9333", () => {
  expect(DEFAULT_DEV_CDP_PORT).toBe(9333);
});

test("isDevRuntime when VITE_DEV_SERVER_URL is set", () => {
  delete process.env.VITE_DEV_SERVER_URL;
  expect(isDevRuntime()).toBe(false);
  process.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:5173/";
  expect(isDevRuntime()).toBe(true);
});

test("isDevCdpEnabled defaults on in dev", () => {
  process.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:5173/";
  delete process.env.ECO_DEV_CDP;
  expect(isDevCdpEnabled()).toBe(true);
  process.env.ECO_DEV_CDP = "0";
  expect(isDevCdpEnabled()).toBe(false);
});

test("resolveDevRemoteDebuggingPort returns default 9333 when enabled", () => {
  process.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:5173/";
  delete process.env.ECO_DEV_CDP;
  delete process.env.ECO_DEV_CDP_PORT;
  expect(resolveDevRemoteDebuggingPort()).toBe(9333);
});

test("resolveDevRemoteDebuggingPort respects ECO_DEV_CDP_PORT", () => {
  process.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:5173/";
  process.env.ECO_DEV_CDP_PORT = "19444";
  expect(resolveDevRemoteDebuggingPort()).toBe(19444);
});

test("resolveDevRemoteDebuggingPort maps forbidden 9222 to default", () => {
  process.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:5173/";
  process.env.ECO_DEV_CDP_PORT = "9222";
  expect(resolveDevRemoteDebuggingPort()).toBe(9333);
});

test("resolveDevRemoteDebuggingPort off when ECO_DEV_CDP=0", () => {
  process.env.ECO_DEV_CDP = "0";
  expect(resolveDevRemoteDebuggingPort()).toBeUndefined();
});

test("resolveDevRemoteDebuggingPort falls back on invalid port env", () => {
  process.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:5173/";
  process.env.ECO_DEV_CDP_PORT = "not-a-port";
  expect(resolveDevRemoteDebuggingPort()).toBe(9333);
});
