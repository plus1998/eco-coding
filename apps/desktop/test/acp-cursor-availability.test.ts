import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { expect, test } from "bun:test";
import {
  assertAcpCursorRunnable,
  handshakeAcpCursor,
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

test("probe maps spawn ENOENT (Cursor not installed) to missingCli without crashing", async () => {
  const fakeChild = new EventEmitter() as ChildProcess;
  fakeChild.stdin = new PassThrough() as unknown as ChildProcess["stdin"];
  fakeChild.stdout = new PassThrough() as unknown as ChildProcess["stdout"];

  const spawnFn = ((_cmd: string, _args: readonly string[], _opts: SpawnOptions) => {
    // Real child_process delivers ENOENT asynchronously on the `error` event.
    setImmediate(() => {
      fakeChild.emit(
        "error",
        Object.assign(new Error("spawn agent ENOENT"), { code: "ENOENT" }),
      );
    });
    return fakeChild;
  }) as typeof import("node:child_process").spawn;

  const result = await probeAcpCursorAvailability({
    // Cursor absent: resolver falls back to bare "agent" (not path-like), so
    // the probe must rely on the handshake failing cleanly with ENOENT.
    resolveExecutable: () => "agent",
    executableExists: () => false,
    handshake: () => handshakeAcpCursor({ spawnFn }),
  });

  expect(result).toMatchObject({ available: false, reasonKey: "missingCli" });
  if (!result.available) {
    expect(result.detail).toContain("ENOENT");
  }
});

test("assertAcpCursorRunnable throws when probe unavailable", () => {
  expect(() =>
    assertAcpCursorRunnable({
      probe: { available: false, reasonKey: "missingCli" },
      unavailableMessage: "unavailable",
    }),
  ).toThrow("unavailable");
});

test("assertAcpCursorRunnable allows when probe available (legacy switch ignored)", () => {
  expect(() =>
    assertAcpCursorRunnable({
      probe: { available: true },
      unavailableMessage: "unavailable",
    }),
  ).not.toThrow();
});
