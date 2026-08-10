import { expect, test } from "bun:test";
import type { CodexAppServerClient } from "@eco/runtime/codex-app-server-client";
import { CodexMidTurnPortRegistry } from "../src/main/codex-mid-turn-port";

function fakeClient(options?: {
  steer?: (params: Record<string, unknown>) => Promise<unknown>;
  fail?: boolean;
}): Pick<CodexAppServerClient, "request"> {
  return {
    async request(method, params) {
      if (method !== "turn/steer") {
        throw new Error(`unexpected method ${method}`);
      }
      if (options?.fail) {
        throw new Error("no active turn");
      }
      if (options?.steer) {
        await options.steer(params as Record<string, unknown>);
      }
      return { turnId: (params as { expectedTurnId: string }).expectedTurnId };
    },
  };
}

test("CodexMidTurnPortRegistry steers while accepting", async () => {
  const registry = new CodexMidTurnPortRegistry();
  const calls: Record<string, unknown>[] = [];
  registry.open("thr_eco", {
    client: fakeClient({
      steer: async (params) => {
        calls.push(params);
      },
    }),
    codexThreadId: "thr_codex",
    turnId: "turn_1",
  });
  expect(registry.isAccepting("thr_eco")).toBe(true);
  const ok = await registry.tryPushUserText("thr_eco", "hello", { clientUserMessageId: "tfu_1" });
  expect(ok).toEqual({ ok: true, turnId: "turn_1" });
  expect(calls).toEqual([
    {
      threadId: "thr_codex",
      expectedTurnId: "turn_1",
      input: [{ type: "text", text: "hello" }],
      clientUserMessageId: "tfu_1",
    },
  ]);

  await registry.closeIngress("thr_eco");
  const rejected = await registry.tryPushUserText("thr_eco", "after");
  expect(rejected.ok).toBe(false);
  registry.close("thr_eco");
  expect(registry.getPhase("thr_eco")).toBeUndefined();
});

test("CodexMidTurnPortRegistry closeIngress waits for inflight steer", async () => {
  const registry = new CodexMidTurnPortRegistry();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  registry.open("thr_slow", {
    client: {
      async request() {
        await gate;
        return { turnId: "turn_slow" };
      },
    },
    codexThreadId: "thr_codex",
    turnId: "turn_slow",
  });

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
