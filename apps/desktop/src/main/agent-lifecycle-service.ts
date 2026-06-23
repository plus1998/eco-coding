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
  pendingToolUses: PendingToolUse[];
  activeAgents: Map<string, AgentInstanceRecord>;
}

interface PendingToolUse {
  toolUseId: string;
  role?: RuntimeAgentRole;
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
    state.pendingToolUses = [];
  }

  noteTaskToolUse(threadId: string, toolUseId: string, role?: RuntimeAgentRole): void {
    const state = this.getOrCreateThread(threadId);
    const pendingRole = role?.trim() || undefined;
    const existing = state.pendingToolUses.find((pending) => pending.toolUseId === toolUseId);
    if (existing) {
      if (!existing.role && pendingRole) {
        existing.role = pendingRole;
      }
      return;
    }
    state.pendingToolUses.push({
      toolUseId,
      ...(pendingRole && { role: pendingRole }),
    });
  }

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
    const parentToolUseId =
      input.parentToolUseId?.trim() || consumePendingToolUseId(state, input.role);
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

  stopSubagent(input: { threadId: string; agentId: string; role: RuntimeAgentRole }): void {
    const state = this.threads.get(input.threadId);
    const existing = state?.activeAgents.get(input.agentId);
    if (!state || !existing) {
      return;
    }
    const now = this.now();
    this.upsertAgent(input.threadId, {
      ...existing,
      status: "stopped",
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
      state.pendingToolUses = [];
      state.activeAgents.clear();
    }

    return { runAttemptsSettled, agentInstancesSettled, settledRunAttemptIds };
  }

  currentRunAttemptId(threadId: string): string | undefined {
    return this.threads.get(threadId)?.currentAttempt?.attemptId;
  }

  currentPlannerAgentId(threadId: string): string | undefined {
    return this.threads.get(threadId)?.currentPlannerAgentId;
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
        pendingToolUses: [],
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

function consumePendingToolUseId(
  state: ThreadLifecycleState,
  role: RuntimeAgentRole,
): string | undefined {
  const roleIndex = state.pendingToolUses.findIndex((pending) => pending.role === role);
  const index = roleIndex >= 0 ? roleIndex : state.pendingToolUses.findIndex((pending) => !pending.role);
  if (index < 0) {
    return undefined;
  }
  const [pending] = state.pendingToolUses.splice(index, 1);
  return pending?.toolUseId;
}
