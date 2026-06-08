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
    status: { stage: "started" | "completed" | "failed"; trigger: "auto" | "manual"; detail?: string },
  ) => void;
  onCompactionBoundary?: (
    threadId: string,
    input: { payload: Record<string, unknown>; sourceEventId?: string },
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
    _routes: readonly ResolvedModelRoute[],
    worktreePath: string,
    _signal: AbortSignal,
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
      await this.options.withSdkDriver(threadId, async (driver, runSignal, driverRoutes) => {
        const routes = driverRoutes;
        if (!driver.compactSession) {
          return;
        }

        let slashCommands: string[] = [];
        let postTokens: number | undefined;

        for await (const event of driver.compactSession({
          threadId,
          prompt: "/compact",
          workspacePath: worktreePath,
          worktreePath,
          routes: [...routes],
          signal: runSignal,
          resume,
        })) {
          if (event.type === "agent.started" && event.payload) {
            const payload = event.payload as Record<string, unknown>;
            const commands = readSdkSlashCommands(payload);
            if (commands.length > 0) {
              slashCommands = commands;
            }
            if (payload.subtype === "compact_boundary") {
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
            const planner = routes.find((route) => route.role === "planner") ?? routes[0];
            if (usage && planner) {
              await this.options.monitor.updateFromUsage(threadId, usage, {
                role: "planner",
                modelId: planner.primary.modelId,
                providerBaseUrl: planner.primary.baseUrl,
              });
            }
          }
        }

        if (slashCommands.length > 0 && !sdkSupportsSlashCommand(slashCommands, "compact")) {
          return;
        }

        this.options.monitor.markCompactCompleted(threadId, postTokens);
        this.emitLiveFromMonitor(threadId);
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.options.emitCompactionStatus(threadId, { stage: "failed", trigger: "auto", detail });
      process.stderr.write(
        `[eco] context compact failed: ${detail}\n`,
      );
    }
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
