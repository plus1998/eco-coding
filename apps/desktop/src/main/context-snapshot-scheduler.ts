import type { ResolvedModelRoute } from "@eco/model-router";
import type { ClaudeAgentSdkDriver } from "@eco/runtime";
import {
  type AgentRuntimeDriver,
  type EcoSdkResumeOptions,
  extractCompactPostTokens,
  extractSdkContextResultText,
  mergeBreakdownWithOccupancy,
  parseContextCommandResult,
  parseUsagePayload,
  readSdkSlashCommands,
  sdkSupportsSlashCommand,
} from "@eco/runtime";
import type { AgentRole, ThreadContextSnapshot, ThreadRoleContextSnapshot } from "../shared/ipc";
import type { ContextMonitorRoleSnapshot, ContextWindowMonitor } from "./context-window-monitor";

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
  private readonly lastSegments = new Map<
    string,
    Partial<Record<AgentRole, ThreadContextSnapshot["segments"]>>
  >();
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

  restoreSnapshot(threadId: string, snapshot: ThreadContextSnapshot): void {
    this.lastEmitted.set(threadId, snapshot);
    if (snapshot.roles && snapshot.roles.length > 0) {
      for (const role of snapshot.roles) {
        if (role.segments.length > 0) {
          this.setLastSegments(threadId, role.role, role.segments);
        }
      }
    } else if (snapshot.segments.length > 0) {
      this.setLastSegments(threadId, snapshot.displayRole ?? "planner", snapshot.segments);
    }
    this.options.monitor.restoreFromContextSnapshot(threadId, snapshot);
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

  clearSubagentState(threadId: string): void {
    const segments = this.lastSegments.get(threadId);
    if (segments) {
      const planner = segments.planner;
      if (planner) {
        this.lastSegments.set(threadId, { planner });
      } else {
        this.lastSegments.delete(threadId);
      }
    }

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
    const breakdownRefreshing = options?.breakdownRefreshing ?? this.breakdownInFlight.has(threadId);
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
      updatedAt: Date.now(),
      ...(breakdownRefreshing && { breakdownRefreshing: true }),
      ...(active.modelId && { modelId: active.modelId }),
      ...(active.maxOutputTokens !== undefined && { maxOutputTokens: active.maxOutputTokens }),
    };
  }

  private buildRoleSnapshot(threadId: string, role: ContextMonitorRoleSnapshot): ThreadRoleContextSnapshot {
    const segments = mergeBreakdownWithOccupancy(
      this.getLastSegments(threadId, role.role),
      role.occupied,
    ).map((segment) => ({
      key: segment.key,
      label: segment.label,
      tokens: segment.tokens,
      color: segment.color,
    }));

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

  private async refreshBreakdownNow(
    threadId: string,
    _routes: readonly ResolvedModelRoute[],
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
          routes: [...routes],
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
        const planner = monitorSnap?.roles.find((role) => role.role === "planner");
        const occupied = planner?.occupied ?? 0;
        const segments = parseContextCommandResult(contextText, occupied);
        if (segments.length > 0) {
          this.setLastSegments(threadId, "planner", segments);
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

  private getLastSegments(threadId: string, role: AgentRole): ThreadContextSnapshot["segments"] {
    return this.lastSegments.get(threadId)?.[role] ?? [];
  }

  private setLastSegments(
    threadId: string,
    role: AgentRole,
    segments: ThreadContextSnapshot["segments"],
  ): void {
    this.lastSegments.set(threadId, {
      ...(this.lastSegments.get(threadId) ?? {}),
      [role]: segments,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
