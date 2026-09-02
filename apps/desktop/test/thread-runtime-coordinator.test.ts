import { describe, expect, test } from "bun:test";
import { type ThreadRuntimeAdapter, ThreadRuntimeCoordinator } from "../src/main/thread-runtime-coordinator";

describe("ThreadRuntimeCoordinator", () => {
  test("routes concurrent thread operations to their owning Core", async () => {
    const calls: string[] = [];
    const coordinator = new ThreadRuntimeCoordinator<string, string, string>();
    for (const kind of ["claude", "codex"] as const) {
      coordinator.register({
        kind,
        start: (input) => calls.push(`${kind}:start:${input}`),
        continue: (input) => calls.push(`${kind}:continue:${input}`),
        cancel: (input) => calls.push(`${kind}:cancel:${input}`),
      } satisfies ThreadRuntimeAdapter<string, string, string, number, number, number>);
    }

    await Promise.all([
      coordinator.start("claude", "a"),
      coordinator.start("codex", "b"),
      coordinator.continue("codex", "b"),
      coordinator.cancel("claude", "a"),
    ]);

    expect(calls).toEqual(["claude:start:a", "codex:start:b", "codex:continue:b", "claude:cancel:a"]);
  });

  test("fails explicitly when a Core is not registered", () => {
    const coordinator = new ThreadRuntimeCoordinator<void, void, void>();
    expect(() => coordinator.start("codex", undefined)).toThrow(
      "Thread runtime adapter is not registered: codex",
    );
  });
});
