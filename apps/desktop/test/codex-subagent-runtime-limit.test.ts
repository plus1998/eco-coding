import { expect, test } from "bun:test";
import { CodexSubagentRuntimeLimitController } from "../src/main/codex-subagent-runtime-limit";

test("CodexSubagentRuntimeLimitController interrupts only the expired child turn", async () => {
  const callbacks: Array<() => void> = [];
  const interrupted: Array<{ threadId: string; agentId: string; turnId: string }> = [];
  const controller = new CodexSubagentRuntimeLimitController({
    maxRuntimeMs: 30 * 60 * 1_000,
    interruptTurn: async (input) => interrupted.push(input),
    schedule(callback) {
      callbacks.push(callback);
      return setTimeout(() => {}, 60_000);
    },
  });

  controller.start({ threadId: "eco_main", agentId: "codex_child_a", turnId: "turn_a" });
  controller.start({ threadId: "eco_main", agentId: "codex_child_b", turnId: "turn_b" });
  callbacks[0]?.();
  await Bun.sleep(0);

  expect(interrupted).toEqual([{ threadId: "eco_main", agentId: "codex_child_a", turnId: "turn_a" }]);
  controller.clear();
});

test("CodexSubagentRuntimeLimitController cancels completed child timers", () => {
  const interrupted: string[] = [];
  let cancelled = 0;
  const controller = new CodexSubagentRuntimeLimitController({
    maxRuntimeMs: 30 * 60 * 1_000,
    interruptTurn: ({ agentId }) => interrupted.push(agentId),
    schedule() {
      return setTimeout(() => {}, 60_000);
    },
    cancel(timer) {
      cancelled += 1;
      clearTimeout(timer);
    },
  });

  controller.start({ threadId: "eco_main", agentId: "codex_child", turnId: "turn_child" });
  controller.stop("codex_child");

  expect(cancelled).toBe(1);
  expect(interrupted).toHaveLength(0);
});
