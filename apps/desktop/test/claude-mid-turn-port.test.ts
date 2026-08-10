import { expect, test } from "bun:test";
import type { ClaudeQueryHandle } from "@eco/runtime/sdk";
import { ClaudeMidTurnPortRegistry } from "../src/main/claude-mid-turn-port";

function fakeHandle(options?: {
  streamInput?: (text: string, uuid?: string) => Promise<void>;
  fail?: boolean;
}): ClaudeQueryHandle {
  return {
    query: {
      async *[Symbol.asyncIterator]() {},
      streamInput: async () => {},
    },
    phase: "open",
    async pushUserMessage(text, opts) {
      if (options?.fail) {
        throw new Error("stream fail");
      }
      await options?.streamInput?.(text, opts?.uuid);
    },
  };
}

test("ClaudeMidTurnPortRegistry accepts only while open", async () => {
  const registry = new ClaudeMidTurnPortRegistry();
  const texts: string[] = [];
  registry.open(
    "thr_1",
    fakeHandle({
      streamInput: async (text) => {
        texts.push(text);
      },
    }),
  );
  expect(registry.isAccepting("thr_1")).toBe(true);
  const ok = await registry.tryPushUserText("thr_1", "hello", { uuid: "tfu_1" });
  expect(ok).toEqual({ ok: true });
  expect(texts).toEqual(["hello"]);

  await registry.closeIngress("thr_1");
  expect(registry.isAccepting("thr_1")).toBe(false);
  const rejected = await registry.tryPushUserText("thr_1", "after close");
  expect(rejected.ok).toBe(false);
  registry.close("thr_1");
  expect(registry.getPhase("thr_1")).toBeUndefined();
});

test("ClaudeMidTurnPortRegistry closeIngress waits for inflight push", async () => {
  const registry = new ClaudeMidTurnPortRegistry();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  registry.open(
    "thr_slow",
    fakeHandle({
      streamInput: async () => {
        await gate;
      },
    }),
  );

  const pushPromise = registry.tryPushUserText("thr_slow", "slow");
  const closing = registry.closeIngress("thr_slow");
  let closed = false;
  void closing.then(() => {
    closed = true;
  });
  await new Promise((r) => setTimeout(r, 5));
  expect(closed).toBe(false);
  release?.();
  await pushPromise;
  await closing;
  expect(closed).toBe(true);
});
