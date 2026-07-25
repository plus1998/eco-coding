import { expect, test } from "bun:test";
import { createSubagentStartHook, createSubagentStopHook } from "../src/eco-sdk-hooks";
import {
  DEFAULT_SUBAGENT_MAX_RUNTIME_MS,
  SubagentRuntimeLimitController,
} from "../src/subagent-runtime-limit";

test("SubagentRuntimeLimitController stops only the timed-out subagent after thirty minutes", async () => {
  const callbacks: Array<() => void> = [];
  const delays: number[] = [];
  const stopped: string[] = [];
  const timedOut: string[] = [];
  const controller = new SubagentRuntimeLimitController({
    stopTask: async (agentId) => {
      stopped.push(agentId);
    },
    onTimeout: ({ agentId }) => timedOut.push(agentId),
    schedule(callback, delayMs) {
      callbacks.push(callback);
      delays.push(delayMs);
      return setTimeout(() => {}, 60_000);
    },
  });

  controller.onStart({ agentId: "agent_a" });
  controller.onStart({ agentId: "agent_b" });
  expect(delays).toEqual([DEFAULT_SUBAGENT_MAX_RUNTIME_MS, DEFAULT_SUBAGENT_MAX_RUNTIME_MS]);

  callbacks[0]?.();
  await Bun.sleep(0);

  expect(stopped).toEqual(["agent_a"]);
  expect(timedOut).toEqual(["agent_a"]);
  controller.clear();
});

test("SubagentRuntimeLimitController cancels the timer when a subagent stops", () => {
  const callbacks: Array<() => void> = [];
  const cancelled: Array<ReturnType<typeof setTimeout>> = [];
  const stopped: string[] = [];
  const controller = new SubagentRuntimeLimitController({
    maxRuntimeMs: 1_000,
    stopTask: (agentId) => stopped.push(agentId),
    schedule(callback) {
      callbacks.push(callback);
      return setTimeout(() => {}, 60_000);
    },
    cancel(timer) {
      cancelled.push(timer);
      clearTimeout(timer);
    },
  });

  controller.onStart({ agentId: "agent_done" });
  controller.onStop({ agentId: "agent_done" });

  expect(cancelled).toHaveLength(1);
  expect(stopped).toHaveLength(0);
  controller.clear();
});

test("SubagentRuntimeLimitController reports synchronous SDK stop failures", async () => {
  let callback: (() => void) | undefined;
  const errors: unknown[] = [];
  const controller = new SubagentRuntimeLimitController({
    stopTask() {
      throw new Error("stop_task rejected");
    },
    onStopError: ({ error }) => errors.push(error),
    schedule(next) {
      callback = next;
      return setTimeout(() => {}, 60_000);
    },
  });

  controller.onStart({ agentId: "agent_error" });
  callback?.();
  await Bun.sleep(0);

  expect(errors).toHaveLength(1);
  expect(errors[0]).toBeInstanceOf(Error);
  expect((errors[0] as Error).message).toBe("stop_task rejected");
  controller.clear();
});

test("subagent lifecycle hooks arm and disarm the runtime limit", async () => {
  const lifecycle: string[] = [];
  const runtimeLimit = {
    onStart: ({ agentId }: { agentId: string }) => lifecycle.push(`start:${agentId}`),
    onStop: ({ agentId }: { agentId: string }) => lifecycle.push(`stop:${agentId}`),
  };
  const startHook = createSubagentStartHook({ runtimeLimit });
  const stopHook = createSubagentStopHook({ runtimeLimit });
  const context = { signal: new AbortController().signal };

  await startHook(
    {
      hook_event_name: "SubagentStart",
      agent_id: "agent_limited",
      agent_type: "eco_coder",
      session_id: "session_1",
      cwd: "/tmp",
    },
    undefined,
    context,
  );
  await stopHook(
    {
      hook_event_name: "SubagentStop",
      stop_hook_active: false,
      agent_id: "agent_limited",
      agent_type: "eco_coder",
      agent_transcript_path: "/tmp/agent.jsonl",
      session_id: "session_1",
      cwd: "/tmp",
    },
    undefined,
    context,
  );

  expect(lifecycle).toEqual(["start:agent_limited", "stop:agent_limited"]);
});
