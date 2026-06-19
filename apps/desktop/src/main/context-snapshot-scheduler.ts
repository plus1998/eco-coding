import type { ResolvedModelRoute } from "@eco/model-router";
import {
  alignBreakdownSegmentsToOccupied,
  normalizeContextSegments,
  parseSdkGetContextUsageBreakdown,
  parseUsagePayload,
  type AgentRuntimeDriver,
  type EcoSdkResumeOptions,
} from "@eco/runtime";
import {
  extractCompactPostTokens,
  readSdkSlashCommands,
  sdkSupportsSlashCommand,
  type ClaudeAgentSdkDriver,
} from "@eco/runtime/sdk";

export interface EcoCompactRunRequest {
  trigger: "auto" | "manual";
  sessionId?: string;
  worktreePath: string;
  signal: AbortSignal;
}

export interface EcoCompactRunResult {
  postTokensEstimate: number;
}
import type { ThreadContextSnapshot, ThreadRoleContextSnapshot } from "../shared/ipc";
import type { ContextMonitorRoleSnapshot, ContextWindowMonitor } from "./context-window-monitor";

type SdkDriver = ClaudeAgentSdkDriver & {
  compactSession?: AgentRuntimeDriver["compactSession"];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export interface ContextSnapshotSchedulerOptions {
  monitor: ContextWindowMonitor;
  isThreadRunning: (threadId: string) => boolean;
  getResume: (threadId: string, worktreePath: string) => EcoSdkResumeOptions | undefined;
  /** When set, skip context refresh if the worktree path is missing or no longer a git worktree. */
  isWorktreePathReady?: (worktreePath: string) => Promise<boolean>;
  withSdkDriver: (
    threadId: string,
    fn: (driver: SdkDriver, signal: AbortSignal, routes: readonly ResolvedModelRoute[]) => Promise<void>,
  ) => Promise<void>;
  emitContext: (threadId: string, snapshot: ThreadContextSnapshot) => void;
  emitCompactionStatus: (
    threadId: string,
    status: {
      stage: "started" | "completed" | "failed";
      trigger: "auto" | "manual";
      detail?: string;
      postTokens?: number;
    },
  ) => void;
  onCompactionBoundary?: (
    threadId: string,
    input: { payload: Record<string, unknown>; sourceEventId?: string },
  ) => void;
  shouldPreferEcoCompact?: (threadId: string) => boolean;
  runEcoCompact?: (threadId: string, input: EcoCompactRunRequest) => Promise<EcoCompactRunResult>;
  archiveBeforeCompaction?: (
    threadId: string,
    trigger: "auto" | "manual",
    sessionId?: string,
  ) => void;
  recordEcoCompactionBoundary?: (
    threadId: string,
    input: { trigger: "auto" | "manual"; postTokens: number },
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
      return false;
    }
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
    routes: readonly ResolvedModelRoute[],
    worktreePath: string,
    signal: AbortSignal,
    options?: { ignoreRunningGuard?: boolean },
  ): Promise<void> {
    if (!this.options.monitor.shouldCompact(threadId)) {
      return;
    }
    if (!options?.ignoreRunningGuard && this.options.isThreadRunning(threadId)) {
      return;
    }

    if (this.options.isWorktreePathReady && !(await this.options.isWorktreePathReady(worktreePath))) {
      return;
    }

    const resume = this.options.getResume(threadId, worktreePath);
    if (!resume?.resumeSessionId) {
      return;
    }

    this.options.monitor.markCompactInFlight(threadId);
    this.options.emitCompactionStatus(threadId, { stage: "started", trigger: "auto" });

    try {
      await this.runCompactSession(threadId, worktreePath, signal, routes, resume, "auto");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.options.monitor.clearCompactInFlight(threadId);
      this.options.emitCompactionStatus(threadId, { stage: "failed", trigger: "auto", detail });
      process.stderr.write(`[eco] context compact failed: ${detail}\n`);
    }
  }

  async compactManual(
    threadId: string,
    routes: readonly ResolvedModelRoute[],
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
      await this.runCompactSession(threadId, worktreePath, signal, routes, resume, "manual");
      return { ok: true };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.options.monitor.clearCompactInFlight(threadId);
      this.options.emitCompactionStatus(threadId, { stage: "failed", trigger: "manual", detail });
      process.stderr.write(`[eco] manual context compact failed: ${detail}\n`);
      return { ok: false, reason: detail };
    }
  }

  private async runCompactSession(
    threadId: string,
    worktreePath: string,
    signal: AbortSignal,
    routes: readonly ResolvedModelRoute[],
    resume: EcoSdkResumeOptions,
    trigger: "auto" | "manual",
  ): Promise<void> {
    if (this.options.shouldPreferEcoCompact?.(threadId)) {
      await this.runEcoCompactPath(threadId, worktreePath, signal, resume, trigger);
      return;
    }

    await this.options.withSdkDriver(threadId, async (driver, runSignal, driverRoutes) => {
      const activeRoutes = driverRoutes.length > 0 ? driverRoutes : routes;
      if (!driver.compactSession) {
        await this.runEcoCompactPath(threadId, worktreePath, runSignal ?? signal, resume, trigger);
        return;
      }

      let slashCommands: string[] = [];
      let postTokens: number | undefined;
      let boundaryRecorded = false;
      let shouldFallbackToEco = false;

      for await (const event of driver.compactSession({
        threadId,
        prompt: "/compact",
        workspacePath: worktreePath,
        worktreePath,
        routes: [...activeRoutes],
        signal: runSignal ?? signal,
        resume,
      })) {
        if (event.type === "agent.started" && event.payload) {
          const payload = event.payload as Record<string, unknown>;
          const commands = readSdkSlashCommands(payload);
          if (commands.length > 0) {
            slashCommands = commands;
            if (!sdkSupportsSlashCommand(commands, "compact")) {
              shouldFallbackToEco = true;
              break;
            }
          }
          if (payload.subtype === "compact_boundary") {
            boundaryRecorded = true;
            postTokens = extractCompactPostTokens(payload);
            this.options.onCompactionBoundary?.(threadId, {
              payload,
              ...(typeof event.id === "string" && { sourceEventId: event.id }),
            });
          }
        }
        if (event.type === "usage.recorded" && isRecord(event.payload)) {
          if (event.payload.type === "sdk_context_usage") {
            this.applySdkContextUsageBreakdown(threadId, event.payload.ecoSdkContextUsage);
            continue;
          }
          const usage = parseUsagePayload(event.payload);
          const planner = activeRoutes.find((route) => route.role === "planner") ?? activeRoutes[0];
          if (usage && planner) {
            await this.options.monitor.updateFromUsage(threadId, usage, {
              role: "planner",
              modelId: planner.primary.modelId,
              providerBaseUrl: planner.primary.baseUrl,
            });
          }
        }
      }

      if (shouldFallbackToEco || (slashCommands.length > 0 && !sdkSupportsSlashCommand(slashCommands, "compact"))) {
        await this.runEcoCompactPath(threadId, worktreePath, runSignal ?? signal, resume, trigger);
        return;
      }

      this.options.monitor.markCompactCompleted(threadId, postTokens);
      this.emitLiveFromMonitor(threadId);
      if (!boundaryRecorded) {
        this.options.emitCompactionStatus(threadId, {
          stage: "completed",
          trigger,
          ...(postTokens !== undefined && { postTokens }),
        });
      }
    });
  }

  private async runEcoCompactPath(
    threadId: string,
    worktreePath: string,
    signal: AbortSignal,
    resume: EcoSdkResumeOptions,
    trigger: "auto" | "manual",
  ): Promise<void> {
    if (!this.options.runEcoCompact) {
      throw new Error("当前驱动不支持上下文压缩。");
    }
    if (trigger === "auto") {
      this.options.archiveBeforeCompaction?.(threadId, trigger, resume.resumeSessionId);
    }
    const result = await this.options.runEcoCompact(threadId, {
      trigger,
      sessionId: resume.resumeSessionId,
      worktreePath,
      signal,
    });
    this.options.recordEcoCompactionBoundary?.(threadId, {
      trigger,
      postTokens: result.postTokensEstimate,
    });
    this.options.monitor.markCompactCompleted(threadId, result.postTokensEstimate);
    this.emitLiveFromMonitor(threadId);
    this.options.emitCompactionStatus(threadId, {
      stage: "completed",
      trigger,
      postTokens: result.postTokensEstimate,
    });
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

  private buildRoleSnapshot(
    threadId: string,
    role: ContextMonitorRoleSnapshot,
  ): ThreadRoleContextSnapshot {
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

  private plannerSegmentsForRole(
    threadId: string,
    occupied: number,
  ): ThreadRoleContextSnapshot["segments"] {
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
