import { expect, test } from "bun:test";
import {
  assertAcpCursorRunnable,
  probeAcpCursorAvailability,
  reconcileAcpCursorEnabled,
} from "../src/main/acp-cursor-availability";

test("probe fails when executable missing", async () => {
  const result = await probeAcpCursorAvailability({
    resolveExecutable: () => "/missing/agent",
    executableExists: () => false,
    handshake: async () => {},
  });
  expect(result).toEqual({ available: false, reasonKey: "missingCli" });
});

test("probe fails when handshake throws", async () => {
  const result = await probeAcpCursorAvailability({
    resolveExecutable: () => "/bin/agent",
    executableExists: () => true,
    handshake: async () => {
      throw new Error("initialize timeout");
    },
  });
  expect(result.available).toBe(false);
  if (!result.available) {
    expect(result.reasonKey).toBe("handshakeFailed");
    expect(result.detail).toContain("initialize timeout");
  }
});

test("probe succeeds when handshake completes", async () => {
  let called = false;
  const result = await probeAcpCursorAvailability({
    resolveExecutable: () => "/bin/agent",
    executableExists: () => true,
    handshake: async () => {
      called = true;
    },
  });
  expect(called).toBe(true);
  expect(result).toEqual({ available: true });
});

test("reconcile clears enabled and falls back default core from acp", () => {
  expect(
    reconcileAcpCursorEnabled({
      acpCursorEnabled: true,
      defaultCoreKind: "acp",
      probe: { available: false, reasonKey: "missingCli" },
    }),
  ).toEqual({ acpCursorEnabled: false, defaultCoreKind: "claude" });
});

test("reconcile no-op when healthy", () => {
  expect(
    reconcileAcpCursorEnabled({
      acpCursorEnabled: true,
      defaultCoreKind: "acp",
      probe: { available: true },
    }),
  ).toBeUndefined();
});

test("assertAcpCursorRunnable throws when switch off", () => {
  expect(() =>
    assertAcpCursorRunnable({
      acpCursorEnabled: false,
      probe: { available: true },
      notEnabledMessage: "not-enabled",
      unavailableMessage: "unavailable",
    }),
  ).toThrow("not-enabled");
});
