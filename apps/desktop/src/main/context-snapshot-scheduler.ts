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
  private refreshInFlight = new Set<string>();

  constructor(private readonly options: ContextSnapshotSchedulerOptions) {}

  scheduleRefresh(
    threadId: string,
    routes: readonly ResolvedModelRoute[],
    worktreePath: string,
    immediate = false,
  ): void {
    const existing = this.timers.get(threadId);
    if (existing) {
      clearTimeout(existing);
    }

    if (immediate) {
      void this.refreshNow(threadId, routes, worktreePath);
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(threadId);
      void this.refreshNow(threadId, routes, worktreePath);
    }, REFRESH_DEBOUNCE_MS);
    this.timers.set(threadId, timer);
  }

  emitFromMonitor(threadId: string, stale = false): void {
    const snapshot = this.buildSnapshotFromMonitor(threadId, stale);
    if (!snapshot) {
      return;
    }
    this.lastEmitted.set(threadId, snapshot);
    this.options.emitContext(threadId, snapshot);
  }

  /** Latest context card for UI hydration (monitor + last /context breakdown). */
  getDisplaySnapshot(threadId: string): ThreadContextSnapshot | undefined {
    return this.lastEmitted.get(threadId) ?? this.buildSnapshotFromMonitor(threadId);
  }

  clearThread(threadId: string): void {
    const timer = this.timers.get(threadId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(threadId);
    }
    this.lastSegments.delete(threadId);
    this.lastEmitted.delete(threadId);
    this.options.monitor.clearThread(threadId);
  }

  private buildSnapshotFromMonitor(
    threadId: string,
    stale = false,
  ): ThreadContextSnapshot | undefined {
    const monitorSnap = this.options.monitor.getSnapshot(threadId);
    if (!monitorSnap || monitorSnap.occupied <= 0) {
      return undefined;
    }
    const segments = this.lastSegments.get(threadId) ?? [];
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
      ...(stale && { stale: true }),
      ...(monitorSnap.maxOutputTokens !== undefined && { maxOutputTokens: monitorSnap.maxOutputTokens }),
    };
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
        this.emitFromMonitor(threadId);
        this.scheduleRefresh(threadId, routes, worktreePath, true);
      });
    } catch (error) {
      process.stderr.write(
        `[eco] context compact failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  private async refreshNow(
    threadId: string,
    routes: readonly ResolvedModelRoute[],
    worktreePath: string,
  ): Promise<void> {
    if (this.options.isThreadRunning(threadId)) {
      this.emitFromMonitor(threadId, true);
      return;
    }

    if (this.refreshInFlight.has(threadId)) {
      return;
    }

    const resume = this.options.getResume(threadId, worktreePath);
    if (!resume?.resumeSessionId) {
      return;
    }

    this.refreshInFlight.add(threadId);

    try {
      await this.options.withSdkDriver(threadId, async (driver, runSignal, driverRoutes) => {
        const routes = driverRoutes;
        if (!driver.contextSnapshot) {
          this.emitFromMonitor(threadId);
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
          this.emitFromMonitor(threadId);
          return;
        }

        const monitorSnap = this.options.monitor.getSnapshot(threadId);
        const occupied = monitorSnap?.occupied ?? 0;
        const segments = parseContextCommandResult(contextText, occupied);
        this.lastSegments.set(threadId, segments);
        this.emitFromMonitor(threadId);
      });
    } catch (error) {
      process.stderr.write(
        `[eco] context snapshot failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      this.emitFromMonitor(threadId);
    } finally {
      this.refreshInFlight.delete(threadId);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
