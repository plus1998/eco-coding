import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createProxyBridgeSettingsStore,
  defaultProxyBridgeSettings,
  normalizeProxyBridgeSettingsSnapshot,
  resolveUpstreamUserAgentOverride,
} from "../src/main/proxy-bridge-settings-store";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

test("defaultProxyBridgeSettings is empty", () => {
  expect(defaultProxyBridgeSettings()).toEqual({});
});

test("normalizeProxyBridgeSettingsSnapshot trims and drops empty", () => {
  expect(normalizeProxyBridgeSettingsSnapshot({ upstreamUserAgent: "  my-ua  " })).toEqual({
    upstreamUserAgent: "my-ua",
  });
  expect(normalizeProxyBridgeSettingsSnapshot({ upstreamUserAgent: "   " })).toEqual({});
});

test("normalizeProxyBridgeSettingsSnapshot rejects newlines", () => {
  expect(() => normalizeProxyBridgeSettingsSnapshot({ upstreamUserAgent: "a\nb" })).toThrow(
    /换行/,
  );
});

test("resolveUpstreamUserAgentOverride returns undefined when unset", () => {
  expect(resolveUpstreamUserAgentOverride({})).toBeUndefined();
  expect(resolveUpstreamUserAgentOverride({ upstreamUserAgent: "x" })).toBe("x");
});

test.skipIf(!sqliteAvailable)("proxy bridge settings persist round-trip", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-proxy-bridge-"));
  const store = await createProxyBridgeSettingsStore(path.join(dir, "eco.sqlite"));

  expect(store.get()).toEqual({});

  store.save({ upstreamUserAgent: "gateway/1" });
  expect(store.get()).toEqual({ upstreamUserAgent: "gateway/1" });

  store.save({});
  expect(store.get()).toEqual({});
});
