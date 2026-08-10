import type { RuntimeAgentRole } from "../shared/ipc";
import type {
  AgentInstanceRecord,
  RunAttemptPhase,
  RunAttemptRecord,
  RunAttemptStatus,
} from "./usage-ledger";

export interface AgentLifecycleStore {
  upsertRunAttempt(record: RunAttemptRecord): void;
  upsertAgentInstance(record: AgentInstanceRecord): void;
}

export interface AgentLifecycleServiceOptions {
  now?: () => string;
  attemptId?: (input: { threadId: string; phase: RunAttemptPhase; retryIndex: number }) => string;
}

export interface AgentLifecycleRecoveryInput {
  threadId: string;
  attempts: readonly RunAttemptRecord[];
  agents: readonly AgentInstanceRecord[];
  runStatus: Exclude<RunAttemptStatus, "running">;
}

export interface AgentLifecycleRecoveryResult {
  runAttemptsSettled: number;
  agentInstancesSettled: number;
  settledRunAttemptIds: string[];
}

interface ThreadLifecycleState {
  currentAttempt?: RunAttemptRecord;
  currentPlannerAgentId?: string;
  lastAttemptId?: string;
  lastPlannerAgentId?: string;
  activeAgents: Map<string, AgentInstanceRecord>;
}

export class AgentLifecycleService {
  private readonly threads = new Map<string, ThreadLifecycleState>();
  private sequence = 0;

  constructor(
    private readonly store: AgentLifecycleStore,
    private readonly options: AgentLifecycleServiceOptions = {},
  ) {}

  startRunAttempt(input: {
    threadId: string;
    phase: RunAttemptPhase;
    retryIndex: number;
  }): RunAttemptRecord {
    const state = this.getOrCreateThread(input.threadId);
    if (state.currentAttempt) {
      this.finishRunAttempt(input.threadId, "failed");
    }

    const now = this.now();
    const attempt: RunAttemptRecord = {
      threadId: input.threadId,
      attemptId: this.createAttemptId(input),
      phase: input.phase,
      retryIndex: input.retryIndex,
      status: "running",
      startedAt: now,
    };
    state.currentAttempt = attempt;
    state.currentPlannerAgentId = `planner:${attempt.attemptId}`;
    this.store.upsertRunAttempt(attempt);
    this.store.upsertAgentInstance({
      threadId: input.threadId,
      agentId: state.currentPlannerAgentId,
      role: "planner",
      kind: "planner",
      status: "active",
      runAttemptId: attempt.attemptId,
      startedAt: now,
      updatedAt: now,
    });
    return attempt;
  }

  finishRunAttempt(threadId: string, status: Exclude<RunAttemptStatus, "running">): void {
    const state = this.threads.get(threadId);
    const attempt = state?.currentAttempt;
    if (!state || !attempt) {
      return;
    }
    const now = this.now();
    this.store.upsertRunAttempt({
      ...attempt,
      status,
      endedAt: now,
    });
    state.lastAttemptId = attempt.attemptId;
    if (state.currentPlannerAgentId) {
      state.lastPlannerAgentId = state.currentPlannerAgentId;
    } else {
      delete state.lastPlannerAgentId;
    }
    for (const agent of state.activeAgents.values()) {
      this.upsertAgent(threadId, {
        ...agent,
        status: "abandoned",
        endedAt: now,
        updatedAt: now,
      });
    }
    if (state.currentPlannerAgentId) {
      this.store.upsertAgentInstance({
        threadId,
        agentId: state.currentPlannerAgentId,
        role: "planner",
        kind: "planner",
        status: status === "completed" ? "stopped" : "abandoned",
        runAttemptId: attempt.attemptId,
        startedAt: attempt.startedAt,
        endedAt: now,
        updatedAt: now,
      });
    }
    delete state.currentAttempt;
    delete state.currentPlannerAgentId;
    state.activeAgents.clear();
  }

  noteTaskToolUse(_threadId: string, _toolUseId: string, _role?: RuntimeAgentRole): void {}

  startSubagent(input: {
    threadId: string;
    agentId: string;
    role: RuntimeAgentRole;
    missionKey?: string;
    todoId?: string;
    parentToolUseId?: string;
  }): AgentInstanceRecord | undefined {
    const state = this.getOrCreateThread(input.threadId);
    const now = this.now();
    const parentToolUseId = input.parentToolUseId?.trim() || undefined;
    const record: AgentInstanceRecord = {
      threadId: input.threadId,
      agentId: input.agentId,
      role: input.role,
      kind: "subagent",
      status: "active",
      startedAt: now,
      updatedAt: now,
      ...(state.currentAttempt?.attemptId && { runAttemptId: state.currentAttempt.attemptId }),
      ...(state.currentPlannerAgentId && { parentAgentId: state.currentPlannerAgentId }),
      ...(parentToolUseId && { parentToolUseId }),
      ...(input.missionKey && { missionKey: input.missionKey }),
      ...(input.todoId && { todoId: input.todoId }),
    };
    this.upsertAgent(input.threadId, record);
    return record;
  }

  linkSubagentParentToolUse(input: {
    threadId: string;
    agentId: string;
    parentToolUseId: string;
  }): AgentInstanceRecord | undefined {
    const agentId = input.agentId.trim();
    const parentToolUseId = input.parentToolUseId.trim();
    if (!agentId || !parentToolUseId) {
      return undefined;
    }
    const state = this.threads.get(input.threadId);
    const existing = state?.activeAgents.get(agentId);
    if (!existing) {
      return undefined;
    }
    const now = this.now();
    const updated: AgentInstanceRecord = {
      ...existing,
      parentToolUseId,
      updatedAt: now,
    };
    this.upsertAgent(input.threadId, updated);
    return updated;
  }

  stopSubagent(input: { threadId: string; agentId: string; role: RuntimeAgentRole }): void {
    this.finishSubagent(input, "stopped");
  }

  abandonSubagent(input: { threadId: string; agentId: string; role: RuntimeAgentRole }): void {
    this.finishSubagent(input, "abandoned");
  }

  private finishSubagent(
    input: { threadId: string; agentId: string; role: RuntimeAgentRole },
    status: "stopped" | "abandoned",
  ): void {
    const state = this.threads.get(input.threadId);
    const existing = state?.activeAgents.get(input.agentId);
    if (!state || !existing) {
      return;
    }
    const now = this.now();
    this.upsertAgent(input.threadId, {
      ...existing,
      status,
      endedAt: now,
      updatedAt: now,
    });
    state.activeAgents.delete(input.agentId);
  }

  settleRecoveredThread(input: AgentLifecycleRecoveryInput): AgentLifecycleRecoveryResult {
    const now = this.now();
    let runAttemptsSettled = 0;
    let agentInstancesSettled = 0;
    const settledRunAttemptIds: string[] = [];

    for (const attempt of input.attempts) {
      if (attempt.status !== "running") {
        continue;
      }
      this.store.upsertRunAttempt({
        ...attempt,
        status: input.runStatus,
        endedAt: attempt.endedAt ?? now,
      });
      runAttemptsSettled += 1;
      settledRunAttemptIds.push(attempt.attemptId);
    }

    for (const agent of input.agents) {
      if (agent.status !== "active" && agent.status !== "launching") {
        continue;
      }
      this.store.upsertAgentInstance({
        ...agent,
        status: "abandoned",
        endedAt: agent.endedAt ?? now,
        updatedAt: now,
      });
      agentInstancesSettled += 1;
    }

    const state = this.threads.get(input.threadId);
    if (state) {
      delete state.currentAttempt;
      delete state.currentPlannerAgentId;
      state.activeAgents.clear();
    }

    return { runAttemptsSettled, agentInstancesSettled, settledRunAttemptIds };
  }

  currentRunAttemptId(threadId: string): string | undefined {
    return this.threads.get(threadId)?.currentAttempt?.attemptId;
  }

  /**
   * Rewind/fork prunes DB rows with started_at ≥ the edited user message, which
   * also deletes the in-flight attempt started for the continuation. Re-persist
   * the lifecycle attempt (optionally retime startedAt after the replacement prompt).
   */
  rehydrateCurrentRunAttempt(threadId: string, startedAt?: string): boolean {
    const state = this.threads.get(threadId);
    const attempt = state?.currentAttempt;
    if (!attempt) {
      return false;
    }
    const now = startedAt?.trim() || this.now();
    const nextAttempt: RunAttemptRecord = {
      threadId: attempt.threadId,
      attemptId: attempt.attemptId,
      phase: attempt.phase,
      retryIndex: attempt.retryIndex,
      status: "running",
      startedAt: now,
    };
    state.currentAttempt = nextAttempt;
    this.store.upsertRunAttempt(nextAttempt);
    if (state.currentPlannerAgentId) {
      this.store.upsertAgentInstance({
        threadId,
        agentId: state.currentPlannerAgentId,
        role: "planner",
        kind: "planner",
        status: "active",
        runAttemptId: nextAttempt.attemptId,
        startedAt: now,
        updatedAt: now,
      });
    }
    return true;
  }

  currentPlannerAgentId(threadId: string): string | undefined {
    return this.threads.get(threadId)?.currentPlannerAgentId;
  }

  activeSubagentCount(threadId: string): number {
    return this.threads.get(threadId)?.activeAgents.size ?? 0;
  }

  usageRunAttemptId(threadId: string): string | undefined {
    const state = this.threads.get(threadId);
    return state?.currentAttempt?.attemptId ?? state?.lastAttemptId;
  }

  usagePlannerAgentId(threadId: string): string | undefined {
    const state = this.threads.get(threadId);
    return state?.currentPlannerAgentId ?? state?.lastPlannerAgentId;
  }

  private upsertAgent(threadId: string, record: AgentInstanceRecord): void {
    const state = this.getOrCreateThread(threadId);
    if (record.status === "active") {
      state.activeAgents.set(record.agentId, record);
    }
    this.store.upsertAgentInstance(record);
  }

  private getOrCreateThread(threadId: string): ThreadLifecycleState {
    let state = this.threads.get(threadId);
    if (!state) {
      state = {
        activeAgents: new Map(),
      };
      this.threads.set(threadId, state);
    }
    return state;
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }

  private createAttemptId(input: {
    threadId: string;
    phase: RunAttemptPhase;
    retryIndex: number;
  }): string {
    if (this.options.attemptId) {
      return this.options.attemptId(input);
    }
    this.sequence += 1;
    return `attempt_${input.phase}_${input.retryIndex}_${Date.now()}_${this.sequence}`;
  }
}
