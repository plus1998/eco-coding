import { expect, test } from "bun:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { type PiSessionHandle, PiSessionRegistry } from "../src/pi-coding-agent-driver";
import { disposePiSdkSession } from "../src/pi-session-dispose";

test("SDK shutdown is awaited before dispose and runs only once", async () => {
  const order: string[] = [];
  const session = {
    abort: async () => {
      order.push("abort");
    },
    extensionRunner: {
      emit: async (event: { type: string; reason: string }) => {
        expect(event).toEqual({ type: "session_shutdown", reason: "quit" });
        await Promise.resolve();
        order.push("shutdown");
      },
    },
    dispose: () => {
      order.push("dispose");
    },
  } as unknown as AgentSession;
  const first = disposePiSdkSession(session);
  expect(disposePiSdkSession(session)).toBe(first);
  await first;
  expect(order).toEqual(["abort", "shutdown", "dispose"]);
});

test("abort failure still closes extensions and preserves its error", async () => {
  const order: string[] = [];
  const session = {
    abort: async () => {
      throw new Error("abort-failed");
    },
    extensionRunner: {
      emit: async () => {
        order.push("shutdown");
      },
    },
    dispose: () => {
      order.push("dispose");
    },
  } as unknown as AgentSession;
  await expect(disposePiSdkSession(session)).rejects.toThrow("abort-failed");
  expect(order).toEqual(["shutdown", "dispose"]);
});

test("registry waits for pending parent and child disposals, including already removed sessions", async () => {
  const registry = new PiSessionRegistry();
  const closed: string[] = [];
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  for (const key of ["thread", "thread::sub::worker", "other"]) {
    registry.set(key, {
      dispose: async () => {
        await pending;
        closed.push(key);
      },
    } as PiSessionHandle);
  }
  const firstDelete = registry.delete("thread");
  expect(registry.get("thread")).toBeUndefined();
  let finished = false;
  const all = registry.deleteAll().then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  release?.();
  await Promise.all([firstDelete, all]);
  expect(closed.sort()).toEqual(["other", "thread", "thread::sub::worker"]);
});

test("registry reports shutdown errors after attempting every session", async () => {
  const registry = new PiSessionRegistry();
  let childClosed = false;
  registry.set("thread", {
    dispose: async () => {
      throw new Error("shutdown-failed");
    },
  } as PiSessionHandle);
  registry.set("thread::sub::worker", {
    dispose: async () => {
      childClosed = true;
    },
  } as PiSessionHandle);
  await expect(registry.deleteThread("thread")).rejects.toThrow("PI session shutdown failed");
  expect(childClosed).toBe(true);
});
