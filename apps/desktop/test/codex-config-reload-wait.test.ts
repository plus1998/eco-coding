import { expect, test } from "bun:test";
import {
  type CodexConfigReloadReadiness,
  waitForCodexConfigReload,
} from "../src/main/codex-config-reload-wait";

test("waitForCodexConfigReload waits for active turns and then continues", async () => {
  const snapshots: CodexConfigReloadReadiness[] = [
    { kind: "busy", activeThreadIds: ["codex-active"] },
    { kind: "ready" },
  ];
  const waits: number[] = [];
  const waiting: string[][] = [];

  const result = await waitForCodexConfigReload({
    check: async () => snapshots.shift() ?? { kind: "ready" },
    pollIntervalMs: 25,
    wait: async (delayMs) => {
      waits.push(delayMs);
    },
    onWaiting: (threadIds) => waiting.push([...threadIds]),
  });

  expect(result).toBe("ready");
  expect(waits).toEqual([25]);
  expect(waiting).toEqual([["codex-active"]]);
});

test("waitForCodexConfigReload only reports when the blocker set changes", async () => {
  const snapshots: CodexConfigReloadReadiness[] = [
    { kind: "busy", activeThreadIds: ["codex-a"] },
    { kind: "busy", activeThreadIds: ["codex-a"] },
    { kind: "busy", activeThreadIds: ["codex-b"] },
    { kind: "skip" },
  ];
  const waiting: string[][] = [];

  const result = await waitForCodexConfigReload({
    check: async () => snapshots.shift() ?? { kind: "skip" },
    wait: async () => {},
    onWaiting: (threadIds) => waiting.push([...threadIds]),
  });

  expect(result).toBe("skip");
  expect(waiting).toEqual([["codex-a"], ["codex-b"]]);
});

test("waitForCodexConfigReload can be cancelled while waiting", async () => {
  const controller = new AbortController();
  const waiting = waitForCodexConfigReload({
    check: async () => ({ kind: "busy", activeThreadIds: ["codex-active"] }),
    signal: controller.signal,
    pollIntervalMs: 60_000,
  });

  controller.abort("cancelled by user");

  await expect(waiting).rejects.toBe("cancelled by user");
});

test("waitForCodexConfigReload does not continue when cancelled during the readiness check", async () => {
  const controller = new AbortController();

  const waiting = waitForCodexConfigReload({
    check: async () => {
      controller.abort("cancelled before reload");
      return { kind: "ready" };
    },
    signal: controller.signal,
  });

  await expect(waiting).rejects.toBe("cancelled before reload");
});
