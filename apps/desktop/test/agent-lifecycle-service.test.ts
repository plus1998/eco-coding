import { expect, test } from "bun:test";
import {
  AgentLifecycleService,
  type AgentLifecycleStore,
} from "../src/main/agent-lifecycle-service";
import type { AgentInstanceRecord, RunAttemptRecord } from "../src/main/usage-ledger";

class FakeLifecycleStore implements AgentLifecycleStore {
  readonly attempts = new Map<string, RunAttemptRecord>();
  readonly agents = new Map<string, AgentInstanceRecord>();

  upsertRunAttempt(record: RunAttemptRecord): void {
    this.attempts.set(`${record.threadId}:${record.attemptId}`, record);
  }

  upsertAgentInstance(record: AgentInstanceRecord): void {
    this.agents.set(`${record.threadId}:${record.agentId}`, record);
  }

  getAttempt(threadId: string, attemptId: string): RunAttemptRecord | undefined {
    return this.attempts.get(`${threadId}:${attemptId}`);
  }

  getAgent(threadId: string, agentId: string): AgentInstanceRecord | undefined {
    return this.agents.get(`${threadId}:${agentId}`);
  }
}

function createService(store: FakeLifecycleStore): AgentLifecycleService {
  let tick = 0;
  return new AgentLifecycleService(store, {
    now: () => `2026-01-01T00:00:0${tick++}.000Z`,
    attemptId: ({ phase, retryIndex }) => `attempt_${phase}_${retryIndex}`,
  });
}

test("AgentLifecycleService records run attempts and planner agent lifecycle", () => {
  const store = new FakeLifecycleStore();
  const service = createService(store);

  const attempt = service.startRunAttempt({
    threadId: "thr_lifecycle",
    phase: "execution",
    retryIndex: 0,
  });
  expect(attempt.attemptId).toBe("attempt_execution_0");
  expect(service.currentRunAttemptId("thr_lifecycle")).toBe("attempt_execution_0");
  expect(service.currentPlannerAgentId("thr_lifecycle")).toBe("planner:attempt_execution_0");

  service.finishRunAttempt("thr_lifecycle", "completed");

  expect(store.getAttempt("thr_lifecycle", "attempt_execution_0")?.status).toBe("completed");
  expect(store.getAgent("thr_lifecycle", "planner:attempt_execution_0")?.status).toBe("stopped");
  expect(service.currentRunAttemptId("thr_lifecycle")).toBeUndefined();
  expect(service.usageRunAttemptId("thr_lifecycle")).toBe("attempt_execution_0");
  expect(service.usagePlannerAgentId("thr_lifecycle")).toBe("planner:attempt_execution_0");
});

test("AgentLifecycleService links interleaved subagents by role-aware parent tool use", () => {
  const store = new FakeLifecycleStore();
  const service = createService(store);
  service.startRunAttempt({ threadId: "thr_lifecycle", phase: "execution", retryIndex: 0 });

  service.noteTaskToolUse("thr_lifecycle", "toolu_explore", "explore");
  service.noteTaskToolUse("thr_lifecycle", "toolu_coder", "coder");
  service.startSubagent({
    threadId: "thr_lifecycle",
    agentId: "agent_coder",
    role: "coder",
    missionKey: "implement",
    todoId: "todo-1",
  });
  service.startSubagent({
    threadId: "thr_lifecycle",
    agentId: "agent_explore",
    role: "explore",
  });

  const coder = store.getAgent("thr_lifecycle", "agent_coder");
  const explore = store.getAgent("thr_lifecycle", "agent_explore");
  expect(coder?.parentToolUseId).toBe("toolu_coder");
  expect(coder?.runAttemptId).toBe("attempt_execution_0");
  expect(coder?.parentAgentId).toBe("planner:attempt_execution_0");
  expect(coder?.todoId).toBe("todo-1");
  expect(explore?.parentToolUseId).toBe("toolu_explore");
});

test("AgentLifecycleService finalizes active subagents as abandoned on failed run", () => {
  const store = new FakeLifecycleStore();
  const service = createService(store);
  service.startRunAttempt({ threadId: "thr_lifecycle", phase: "execution", retryIndex: 0 });
  service.noteTaskToolUse("thr_lifecycle", "toolu_coder", "coder");
  service.startSubagent({
    threadId: "thr_lifecycle",
    agentId: "agent_coder",
    role: "coder",
  });

  service.finishRunAttempt("thr_lifecycle", "failed");

  expect(store.getAttempt("thr_lifecycle", "attempt_execution_0")?.status).toBe("failed");
  expect(store.getAgent("thr_lifecycle", "agent_coder")?.status).toBe("abandoned");
  expect(store.getAgent("thr_lifecycle", "planner:attempt_execution_0")?.status).toBe("abandoned");
});

test("AgentLifecycleService stops subagents explicitly before run finalizer", () => {
  const store = new FakeLifecycleStore();
  const service = createService(store);
  service.startRunAttempt({ threadId: "thr_lifecycle", phase: "execution", retryIndex: 0 });
  service.startSubagent({
    threadId: "thr_lifecycle",
    agentId: "agent_coder",
    role: "coder",
  });

  service.stopSubagent({
    threadId: "thr_lifecycle",
    agentId: "agent_coder",
    role: "coder",
  });
  service.finishRunAttempt("thr_lifecycle", "completed");

  expect(store.getAgent("thr_lifecycle", "agent_coder")?.status).toBe("stopped");
});
