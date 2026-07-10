import {
  alignBreakdownSegmentsToOccupied,
  type EcoSdkResumeOptions,
  normalizeContextSegments,
  parseSdkGetContextUsageBreakdown,
} from "@eco/runtime";
import type { ThreadContextSnapshot, ThreadRoleContextSnapshot } from "../shared/ipc";
import type { ContextMonitorRoleSnapshot, ContextWindowMonitor } from "./context-window-monitor";
import { logEcoDiag, shortThreadId } from "./eco-diag-log";

export interface EcoCompactRunRequest {
  trigger: "auto" | "manual";
  sessionId: string;
  preTokensEstimate?: number;
  preTokensSource?: "sdk_context_usage" | "local_heuristic";
  worktreePath: string;
  signal: AbortSignal;
}

export interface EcoCompactRunResult {
  postTokensEstimate: number;
}

type ContextCompactionMethod = "eco";

function logContextCompaction(
  event: "start" | "complete" | "fail",
  input: {
    threadId: string;
    trigger: "auto" | "manual";
    method?: ContextCompactionMethod;
    sessionId?: string;
    postTokens?: number;
    detail?: string;
  },
): void {
  const fields = [
    `[eco] context compaction ${event}`,
    `thread=${input.threadId}`,
    `trigger=${input.trigger}`,
  ];
  if (input.method) {
    fields.push(`method=${input.method}`);
  }
  if (input.sessionId) {
    fields.push(`session=${input.sessionId}`);
  }
  if (input.postTokens !== undefined) {
    fields.push(`postTokens=${input.postTokens}`);
  }
  if (input.detail) {
    fields.push(`detail=${input.detail}`);
  }
  process.stderr.write(`${fields.join(" ")}\n`);
  logEcoDiag(`context.compaction.${event}`, {
    threadId: shortThreadId(input.threadId),
    trigger: input.trigger,
    ...(input.method && { method: input.method }),
    ...(input.sessionId && { sessionId: input.sessionId }),
    ...(input.postTokens !== undefined && { postTokens: input.postTokens }),
    ...(input.detail && { detail: input.detail }),
  });
}

export interface ContextSnapshotSchedulerOptions {
  monitor: ContextWindowMonitor;
  isThreadRunning: (threadId: string) => boolean;
  getResume: (threadId: string, worktreePath: string) => EcoSdkResumeOptions | undefined;
  /** When set, skip context refresh if the worktree path is missing or no longer a git worktree. */
  isWorktreePathReady?: (worktreePath: string) => Promise<boolean>;
  emitContext: (threadId: string, snapshot: ThreadContextSnapshot) => void;
  emitCompactionStatus: (
    threadId: string,
    status: {
      stage: "started" | "completed" | "failed" | "suspended";
      trigger: "auto" | "manual";
      detail?: string;
      postTokens?: number;
      consecutiveFailures?: number;
    },
  ) => void;
  runEcoCompact?: (threadId: string, input: EcoCompactRunRequest) => Promise<EcoCompactRunResult>;
  archiveBeforeCompaction?: (
    threadId: string,
    trigger: "auto" | "manual",
    sessionId?: string,
  ) => void | Promise<void>;
  recordEcoCompactionBoundary?: (
    threadId: string,
    input: { trigger: "auto" | "manual"; postTokens: number },
  ) => void;
  recordEcoCompactionFailure?: (
    threadId: string,
    input: { trigger: "auto" | "manual"; sessionId?: string; detail: string },
  ) => void;
}

export class ContextSnapshotScheduler {
  /** Planner-only breakdown segments from SDK `getContextUsage()` (once per turn `result`). */
  private readonly lastPlannerSegments = new Map<string, ThreadContextSnapshot["segments"]>();
  private readonly lastEmitted = new Map<string, ThreadContextSnapshot>();

  constructor(private readonly options: ContextSnapshotSchedulerOptions) {}

  applySdkContextUsageBreakdown(threadId: string, payload: unknown): boolean {
    const parsed = parseSdkGetContextUsageBreakdown(payload);
    if (!parsed) {
      logEcoDiag("context.sdk_breakdown_parse", {
        threadId: shortThreadId(threadId),
        ok: false,
        payloadKind: typeof payload,
      });
      return false;
    }
    logEcoDiag("context.sdk_breakdown_parse", {
      threadId: shortThreadId(threadId),
      ok: true,
      occupied: parsed.occupied,
      limit: parsed.limit,
      occupancyPct: parsed.occupancyPct ?? null,
      segmentCount: parsed.segments.length,
      segments: parsed.segments.slice(0, 8).map((segment) => ({
        key: segment.key,
        tokens: segment.tokens,
      })),
    });
    void this.options.monitor.updateOccupied(threadId, "planner", parsed.occupied, {
      limit: parsed.limit,
    });
    if (parsed.segments.length > 0) {
      this.lastPlannerSegments.set(threadId, parsed.segments);
    }
    this.emitLiveFromMonitor(threadId);
    return true;
  }

  /** Real-time meter from usage / monitor — never marked stale. */
  emitLiveFromMonitor(threadId: string): void {
    const snapshot = this.buildSnapshot(threadId);
    if (!snapshot) {
      return;
    }
    this.lastEmitted.set(threadId, snapshot);
    this.options.emitContext(threadId, snapshot);
  }

  /** @deprecated Use emitLiveFromMonitor; kept for call sites being migrated. */
  emitFromMonitor(threadId: string, _stale = false): void {
    this.emitLiveFromMonitor(threadId);
  }

  getDisplaySnapshot(threadId: string): ThreadContextSnapshot | undefined {
    return this.lastEmitted.get(threadId) ?? this.buildSnapshot(threadId);
  }

  restoreSnapshot(threadId: string, snapshot: ThreadContextSnapshot): void {
    const plannerRole = snapshot.roles?.find((role) => role.role === "planner");
    const plannerSegments =
      plannerRole?.segments.filter((segment) => segment.tokens > 0) ?? snapshot.segments;
    if (plannerSegments.length > 0) {
      this.lastPlannerSegments.set(threadId, normalizeContextSegments(plannerSegments));
    }
    this.options.monitor.restoreFromContextSnapshot(threadId, snapshot);
    const normalized = this.buildSnapshot(threadId);
    if (normalized) {
      this.lastEmitted.set(threadId, normalized);
    }
  }

  clearThread(threadId: string): void {
    this.lastPlannerSegments.delete(threadId);
    this.lastEmitted.delete(threadId);
    this.options.monitor.clearThread(threadId);
  }

  clearSubagentState(threadId: string): void {
    const emitted = this.lastEmitted.get(threadId);
    const plannerRole = emitted?.roles?.find((role) => role.role === "planner");
    if (!emitted || !plannerRole) {
      this.lastEmitted.delete(threadId);
      return;
    }

    this.lastEmitted.set(threadId, {
      occupied: plannerRole.occupied,
      limit: plannerRole.limit,
      occupancyPct: plannerRole.occupancyPct,
      limitsResolved: plannerRole.limitsResolved,
      displayRole: "planner",
      segments: plannerRole.segments,
      roles: [plannerRole],
      instances: [],
      updatedAt: Date.now(),
      ...(plannerRole.modelId && { modelId: plannerRole.modelId }),
      ...(plannerRole.maxOutputTokens !== undefined && { maxOutputTokens: plannerRole.maxOutputTokens }),
    });
  }

  async ensureHeadroom(
    threadId: string,
    worktreePath: string,
    signal: AbortSignal,
    options?: { ignoreRunningGuard?: boolean },
  ): Promise<boolean> {
    if (this.options.monitor.isCompactInFlight(threadId)) {
      throw new Error("上下文正在压缩中，请稍候。");
    }
    if (
      this.options.monitor.isAutoCompactSuspended(threadId) &&
      this.options.monitor.isAtCompactionThreshold(threadId)
    ) {
      throw new Error("自动上下文压缩已暂停；当前会话仍超过压缩阈值，不能继续恢复旧会话。");
    }
    if (!this.options.monitor.shouldCompact(threadId)) {
      return false;
    }
    if (!options?.ignoreRunningGuard && this.options.isThreadRunning(threadId)) {
      return false;
    }
    if (this.options.isWorktreePathReady && !(await this.options.isWorktreePathReady(worktreePath))) {
      return false;
    }

    const resume = this.options.getResume(threadId, worktreePath);
    if (!resume?.resumeSessionId) {
      return false;
    }

    try {
      await this.runEcoCompactPath(threadId, worktreePath, signal, resume, "auto");
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.options.monitor.clearCompactInFlight(threadId);
      const failure = this.options.monitor.recordAutoCompactFailure(threadId);
      logContextCompaction("fail", { threadId, trigger: "auto", method: "eco", detail });
      this.recordCompactionFailure(threadId, "auto", detail, resume.resumeSessionId);
      if (failure.tripped) {
        this.options.emitCompactionStatus(threadId, {
          stage: "suspended",
          trigger: "auto",
          consecutiveFailures: failure.failures,
        });
      }
      process.stderr.write(`[eco] context compact failed: ${detail}\n`);
      throw error;
    }
  }

  async compactManual(
    threadId: string,
    worktreePath: string,
    signal: AbortSignal,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (this.options.isThreadRunning(threadId)) {
      return { ok: false, reason: "thread_running" };
    }
    if (this.options.monitor.isCompactInFlight(threadId)) {
      return { ok: false, reason: "compact_in_flight" };
    }
    if (this.options.isWorktreePathReady && !(await this.options.isWorktreePathReady(worktreePath))) {
      return { ok: false, reason: "worktree_not_ready" };
    }

    const resume = this.options.getResume(threadId, worktreePath);
    if (!resume?.resumeSessionId) {
      return { ok: false, reason: "no_session" };
    }

    try {
      await this.runEcoCompactPath(threadId, worktreePath, signal, resume, "manual");
      return { ok: true };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.options.monitor.clearCompactInFlight(threadId);
      logContextCompaction("fail", { threadId, trigger: "manual", method: "eco", detail });
      this.recordCompactionFailure(threadId, "manual", detail, resume.resumeSessionId);
      process.stderr.write(`[eco] manual context compact failed: ${detail}\n`);
      return { ok: false, reason: detail };
    }
  }

  private async runEcoCompactPath(
    threadId: string,
    worktreePath: string,
    signal: AbortSignal,
    resume: EcoSdkResumeOptions,
    trigger: "auto" | "manual",
  ): Promise<void> {
    if (!this.options.monitor.beginCompactIfIdle(threadId)) {
      throw new Error("上下文正在压缩中，请稍候。");
    }
    logContextCompaction("start", {
      threadId,
      trigger,
      method: "eco",
      ...(resume.resumeSessionId && { sessionId: resume.resumeSessionId }),
    });

    if (!this.options.runEcoCompact) {
      throw new Error("Eco 上下文压缩服务未配置。");
    }
    if (this.options.archiveBeforeCompaction) {
      await this.options.archiveBeforeCompaction(threadId, trigger, resume.resumeSessionId);
    } else {
      this.options.emitCompactionStatus(threadId, { stage: "started", trigger });
    }

    const sourceSessionId = resume.resumeSessionId;
    if (!sourceSessionId) {
      throw new Error("缺少待压缩的源 SDK session。");
    }
    const preTokensEstimate = this.options.monitor.getRoleOccupancy(threadId, "planner");
    const result = await this.options.runEcoCompact(threadId, {
      trigger,
      sessionId: sourceSessionId,
      ...(preTokensEstimate > 0 && {
        preTokensEstimate,
        preTokensSource: "sdk_context_usage" as const,
      }),
      worktreePath,
      signal,
    });
    this.options.monitor.markCompactCompleted(threadId, result.postTokensEstimate);
    this.emitLiveFromMonitor(threadId);
    if (this.options.recordEcoCompactionBoundary) {
      this.options.recordEcoCompactionBoundary(threadId, {
        trigger,
        postTokens: result.postTokensEstimate,
      });
    } else {
      this.options.emitCompactionStatus(threadId, {
        stage: "completed",
        trigger,
        postTokens: result.postTokensEstimate,
      });
    }
    logContextCompaction("complete", {
      threadId,
      trigger,
      method: "eco",
      postTokens: result.postTokensEstimate,
      ...(resume.resumeSessionId && { sessionId: resume.resumeSessionId }),
    });
  }

  private recordCompactionFailure(
    threadId: string,
    trigger: "auto" | "manual",
    detail: string,
    sessionId?: string,
  ): void {
    if (this.options.recordEcoCompactionFailure) {
      this.options.recordEcoCompactionFailure(threadId, {
        trigger,
        ...(sessionId && { sessionId }),
        detail,
      });
      return;
    }
    this.options.emitCompactionStatus(threadId, { stage: "failed", trigger, detail });
  }

  private buildSnapshot(threadId: string): ThreadContextSnapshot | undefined {
    const monitorSnap = this.options.monitor.getSnapshot(threadId);
    if (!monitorSnap || monitorSnap.occupied <= 0) {
      return undefined;
    }
    const roles = monitorSnap.roles.map((role) => this.buildRoleSnapshot(threadId, role));
    const active = roles.find((role) => role.role === monitorSnap.displayRole) ?? roles[0];
    if (!active) {
      return undefined;
    }
    return {
      occupied: active.occupied,
      limit: active.limit,
      occupancyPct: active.occupancyPct,
      limitsResolved: active.limitsResolved,
      displayRole: active.role,
      segments: active.segments,
      roles,
      instances: monitorSnap.instances ?? [],
      updatedAt: Date.now(),
      ...(active.modelId && { modelId: active.modelId }),
      ...(active.maxOutputTokens !== undefined && { maxOutputTokens: active.maxOutputTokens }),
    };
  }

  private buildRoleSnapshot(threadId: string, role: ContextMonitorRoleSnapshot): ThreadRoleContextSnapshot {
    const segments =
      role.role === "planner"
        ? this.plannerSegmentsForRole(threadId, role.occupied)
        : role.occupied > 0
          ? [fallbackSegment(role.occupied)]
          : [];
    return {
      role: role.role,
      occupied: role.occupied,
      limit: role.limit,
      occupancyPct: role.occupancyPct,
      limitsResolved: role.limitsResolved,
      segments,
      ...(role.modelId && { modelId: role.modelId }),
      ...(role.maxOutputTokens !== undefined && { maxOutputTokens: role.maxOutputTokens }),
    };
  }

  private plannerSegmentsForRole(threadId: string, occupied: number): ThreadRoleContextSnapshot["segments"] {
    const raw = this.lastPlannerSegments.get(threadId);
    if (!raw || raw.length === 0) {
      return occupied > 0 ? [fallbackSegment(occupied)] : [];
    }
    return alignBreakdownSegmentsToOccupied(raw, occupied);
  }
}

function fallbackSegment(tokens: number): ThreadContextSnapshot["segments"][number] {
  return {
    key: "conversation",
    label: "会话",
    tokens,
    color: "#ea580c",
  };
}
