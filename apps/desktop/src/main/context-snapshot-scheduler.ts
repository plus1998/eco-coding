import type { ResolvedModelRoute } from "@eco/model-router";
import {
  mergeBreakdownWithOccupancy,
  normalizeContextSegments,
  parseSdkGetContextUsageBreakdown,
  parseUsagePayload,
  type EcoSdkResumeOptions,
} from "@eco/runtime";
import {
  extractCompactPostTokens,
  readSdkSlashCommands,
  sdkSupportsSlashCommand,
  type AgentRuntimeDriver,
  type ClaudeAgentSdkDriver,
} from "@eco/runtime/sdk";
import type { ThreadContextSnapshot, ThreadRoleContextSnapshot } from "../shared/ipc";
import type { ContextMonitorRoleSnapshot, ContextWindowMonitor } from "./context-window-monitor";
import { logContextSnapshot } from "./context-snapshot-log";

const REFRESH_DEBOUNCE_MS = 3000;
/** Skip redundant getContextUsage fetch when one ran recently on the same thread. */
const SDK_CONTEXT_USAGE_FRESH_MS = 60_000;

type SdkDriver = ClaudeAgentSdkDriver & {
  compactSession?: AgentRuntimeDriver["compactSession"];
  fetchContextUsage?: AgentRuntimeDriver["fetchContextUsage"];
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
  emitActivity: (threadId: string, message: string) => void;
}

export class ContextSnapshotScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Planner-only breakdown segments from SDK `getContextUsage()`. */
  private readonly lastPlannerSegments = new Map<string, ThreadContextSnapshot["segments"]>();
  private readonly lastEmitted = new Map<string, ThreadContextSnapshot>();
  private readonly breakdownInFlight = new Set<string>();
  private readonly refreshInFlight = new Set<string>();
  private readonly lastSdkContextUsageAt = new Map<string, number>();

  constructor(private readonly options: ContextSnapshotSchedulerOptions) {}

  hasRecentSdkContextUsage(threadId: string, maxAgeMs = SDK_CONTEXT_USAGE_FRESH_MS): boolean {
    const at = this.lastSdkContextUsageAt.get(threadId);
    return at !== undefined && Date.now() - at < maxAgeMs;
  }

  applySdkContextUsageBreakdown(threadId: string, payload: unknown): boolean {
    const parsed = parseSdkGetContextUsageBreakdown(payload);
    if (!parsed) {
      return false;
    }
    void this.options.monitor.updateOccupied(threadId, "planner", parsed.occupied, {
      limit: parsed.limit,
    });
    if (parsed.segments.length > 0) {
      this.lastPlannerSegments.set(threadId, normalizeContextSegments(parsed.segments));
    }
    this.lastSdkContextUsageAt.set(threadId, Date.now());
    this.emitLiveFromMonitor(threadId);
    return true;
  }

  /** Real-time meter from usage / monitor — never marked stale. */
  emitLiveFromMonitor(threadId: string): void {
    const snapshot = this.buildSnapshot(threadId, { breakdownRefreshing: false });
    if (!snapshot) {
      return;
    }
    this.lastEmitted.set(threadId, snapshot);
    this.options.emitContext(threadId, snapshot);
  }

  scheduleBreakdownRefresh(
    threadId: string,
    routes: readonly ResolvedModelRoute[],
    worktreePath: string,
    immediate = false,
  ): void {
    if (this.hasRecentSdkContextUsage(threadId)) {
      return;
    }
    if (this.options.isThreadRunning(threadId)) {
      return;
    }

    const existing = this.timers.get(threadId);
    if (existing) {
      clearTimeout(existing);
    }

    if (immediate) {
      void this.refreshBreakdownNow(threadId, routes, worktreePath);
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(threadId);
      void this.refreshBreakdownNow(threadId, routes, worktreePath);
    }, REFRESH_DEBOUNCE_MS);
    this.timers.set(threadId, timer);
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
    const timer = this.timers.get(threadId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(threadId);
    }
    this.lastPlannerSegments.delete(threadId);
    this.lastEmitted.delete(threadId);
    this.breakdownInFlight.delete(threadId);
    this.refreshInFlight.delete(threadId);
    this.lastSdkContextUsageAt.delete(threadId);
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
    this.options.emitActivity(threadId, "Compacting context…");

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
            }
          }
          if (event.type === "usage.recorded") {
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
        this.scheduleBreakdownRefresh(threadId, routes, worktreePath, true);
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.options.emitActivity(threadId, `Context compact failed: ${detail}`);
      process.stderr.write(
        `[eco] context compact failed: ${detail}\n`,
      );
    }
  }

  private buildSnapshot(
    threadId: string,
    options?: { breakdownRefreshing?: boolean },
  ): ThreadContextSnapshot | undefined {
    const monitorSnap = this.options.monitor.getSnapshot(threadId);
    if (!monitorSnap || monitorSnap.occupied <= 0) {
      return undefined;
    }
    const roles = monitorSnap.roles.map((role) => this.buildRoleSnapshot(threadId, role));
    const active = roles.find((role) => role.role === monitorSnap.displayRole) ?? roles[0];
    if (!active) {
      return undefined;
    }
    const breakdownRefreshing =
      options?.breakdownRefreshing ?? this.breakdownInFlight.has(threadId);
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
      ...(breakdownRefreshing && active.role === "planner" && { breakdownRefreshing: true }),
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
    return mergeBreakdownWithOccupancy(raw, occupied).map((segment) => ({
      key: segment.key,
      label: segment.label,
      tokens: segment.tokens,
      color: segment.color,
    }));
  }

  private async refreshBreakdownNow(
    threadId: string,
    routes: readonly ResolvedModelRoute[],
    worktreePath: string,
  ): Promise<void> {
    if (this.options.isThreadRunning(threadId)) {
      return;
    }

    if (this.refreshInFlight.has(threadId)) {
      return;
    }

    if (this.options.isWorktreePathReady && !(await this.options.isWorktreePathReady(worktreePath))) {
      this.emitLiveFromMonitor(threadId);
      return;
    }

    const resume = this.options.getResume(threadId, worktreePath);
    if (!resume?.resumeSessionId) {
      this.emitLiveFromMonitor(threadId);
      return;
    }

    this.refreshInFlight.add(threadId);
    this.breakdownInFlight.add(threadId);
    const pending = this.buildSnapshot(threadId, { breakdownRefreshing: true });
    if (pending) {
      this.lastEmitted.set(threadId, pending);
      this.options.emitContext(threadId, pending);
    }

    const startedAt = Date.now();
    logContextSnapshot("start", {
      threadId,
      trigger: "scheduled",
      resumeSessionId: resume.resumeSessionId,
      worktreePath,
    });

    try {
      await this.options.withSdkDriver(threadId, async (driver, runSignal, driverRoutes) => {
        const driverRoutesList = driverRoutes;
        if (!driver.fetchContextUsage) {
          return;
        }

        let applied = false;

        for await (const event of driver.fetchContextUsage({
          threadId,
          prompt: "",
          workspacePath: worktreePath,
          worktreePath,
          routes: [...driverRoutesList],
          signal: runSignal,
          resume,
        })) {
          if (
            event.type === "usage.recorded" &&
            isRecord(event.payload) &&
            event.payload.type === "sdk_context_usage"
          ) {
            applied = this.applySdkContextUsageBreakdown(threadId, event.payload.ecoSdkContextUsage);
            logContextSnapshot("sdk_context_usage", {
              threadId,
              applied,
              payloadKeys: Object.keys(event.payload),
            });
          }
        }

        if (!applied) {
          logContextSnapshot("no_sdk_context_usage", { threadId });
        }
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.options.emitActivity(threadId, `Context snapshot failed: ${detail}`);
      process.stderr.write(
        `[eco] context snapshot failed: ${detail}\n`,
      );
    } finally {
      logContextSnapshot("done", { threadId, elapsedMs: Date.now() - startedAt });
      this.refreshInFlight.delete(threadId);
      this.breakdownInFlight.delete(threadId);
      this.emitLiveFromMonitor(threadId);
    }
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
