import {
  extractSdkContextResultText,
  mergeBreakdownWithOccupancy,
  parseContextCommandResult,
  parseUsagePayload,
  sdkSupportsSlashCommand,
  readSdkSlashCommands,
  extractCompactPostTokens,
  type AgentRuntimeDriver,
  type EcoSdkResumeOptions,
  type ResolvedModelRoute,
} from "@eco/runtime";
import type { ClaudeAgentSdkDriver } from "@eco/runtime";
import type { ThreadContextSnapshot } from "../shared/ipc";
import type { ContextWindowMonitor } from "./context-window-monitor";

const REFRESH_DEBOUNCE_MS = 3000;

type SdkDriver = ClaudeAgentSdkDriver & {
  compactSession?: AgentRuntimeDriver["compactSession"];
  contextSnapshot?: AgentRuntimeDriver["contextSnapshot"];
};

export interface ContextSnapshotSchedulerOptions {
  monitor: ContextWindowMonitor;
  isThreadRunning: (threadId: string) => boolean;
  getResume: (threadId: string, worktreePath: string) => EcoSdkResumeOptions | undefined;
  withSdkDriver: (
    threadId: string,
    fn: (driver: SdkDriver, signal: AbortSignal, routes: readonly ResolvedModelRoute[]) => Promise<void>,
  ) => Promise<void>;
  emitContext: (threadId: string, snapshot: ThreadContextSnapshot) => void;
  emitActivity: (threadId: string, message: string) => void;
}

export class ContextSnapshotScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly lastSegments = new Map<string, ThreadContextSnapshot["segments"]>();
  private readonly lastEmitted = new Map<string, ThreadContextSnapshot>();
  private readonly breakdownInFlight = new Set<string>();
  private refreshInFlight = new Set<string>();

  constructor(private readonly options: ContextSnapshotSchedulerOptions) {}

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

  clearThread(threadId: string): void {
    const timer = this.timers.get(threadId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(threadId);
    }
    this.lastSegments.delete(threadId);
    this.lastEmitted.delete(threadId);
    this.breakdownInFlight.delete(threadId);
    this.options.monitor.clearThread(threadId);
  }

  async ensureHeadroom(
    threadId: string,
    routes: readonly ResolvedModelRoute[],
    worktreePath: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.options.monitor.shouldCompact(threadId)) {
      return;
    }
    if (this.options.isThreadRunning(threadId)) {
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
          routes,
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
      process.stderr.write(
        `[eco] context compact failed: ${error instanceof Error ? error.message : String(error)}\n`,
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
    const segments = this.lastSegments.get(threadId) ?? [];
    const breakdownRefreshing =
      options?.breakdownRefreshing ?? this.breakdownInFlight.has(threadId);
    return {
      occupied: monitorSnap.occupied,
      limit: monitorSnap.limit,
      occupancyPct: monitorSnap.occupancyPct,
      limitsResolved: monitorSnap.limitsResolved,
      segments: mergeBreakdownWithOccupancy(segments, monitorSnap.occupied).map((segment) => ({
        key: segment.key,
        label: segment.label,
        tokens: segment.tokens,
        color: segment.color,
      })),
      updatedAt: Date.now(),
      ...(breakdownRefreshing && { breakdownRefreshing: true }),
      ...(monitorSnap.maxOutputTokens !== undefined && { maxOutputTokens: monitorSnap.maxOutputTokens }),
    };
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

    try {
      await this.options.withSdkDriver(threadId, async (driver, runSignal, driverRoutes) => {
        const routes = driverRoutes;
        if (!driver.contextSnapshot) {
          return;
        }

        let contextText = "";
        let slashCommands: string[] = [];

        for await (const event of driver.contextSnapshot({
          threadId,
          prompt: "/context",
          workspacePath: worktreePath,
          worktreePath,
          routes,
          signal: runSignal,
          resume,
        })) {
          if (event.type === "agent.started" && isRecord(event.payload)) {
            const commands = readSdkSlashCommands(event.payload);
            if (commands.length > 0) {
              slashCommands = commands;
            }
          }
          if (event.type === "usage.recorded" && event.payload) {
            const text = extractSdkContextResultText(event.payload);
            if (text) {
              contextText = text;
            }
          }
        }

        if (slashCommands.length > 0 && !sdkSupportsSlashCommand(slashCommands, "context")) {
          return;
        }

        const monitorSnap = this.options.monitor.getSnapshot(threadId);
        const occupied = monitorSnap?.occupied ?? 0;
        const segments = parseContextCommandResult(contextText, occupied);
        if (segments.length > 0) {
          this.lastSegments.set(threadId, segments);
        }
      });
    } catch (error) {
      process.stderr.write(
        `[eco] context snapshot failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    } finally {
      this.refreshInFlight.delete(threadId);
      this.breakdownInFlight.delete(threadId);
      this.emitLiveFromMonitor(threadId);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
