import { extractCompactPostTokens } from "@eco/runtime/sdk";
import type { ThreadStatus } from "../shared/ipc";
import type { ContextWindowMonitor } from "./context-window-monitor";

export interface ContextLifecycleMonitor {
  shouldCompact: ContextWindowMonitor["shouldCompact"];
  markCompactInFlight: ContextWindowMonitor["markCompactInFlight"];
  markCompactCompleted: ContextWindowMonitor["markCompactCompleted"];
  noteOtelCompaction: ContextWindowMonitor["noteOtelCompaction"];
}

export interface ContextLifecycleServiceInput {
  monitor: ContextLifecycleMonitor;
  emitLiveContext(threadId: string): void;
  ensureHeadroom(
    threadId: string,
    worktreePath: string,
    signal: AbortSignal,
    options?: { ignoreRunningGuard?: boolean },
  ): Promise<void>;
  getThreadStatus(threadId: string): ThreadStatus | undefined;
  resolveThreadWorktreePath(threadId: string): string | undefined;
  applySdkContextUsageBreakdown(threadId: string, payload: unknown): void;
  recordCompactionBoundary(
    threadId: string,
    payload: Record<string, unknown>,
    sourceEventId?: string,
  ): void;
}

export interface ContextLifecycleService {
  afterRunRefresh(threadId: string, worktreePath?: string): void;
  schedulePostRunCompactionIfNeeded(threadId: string, worktreePath: string): Promise<boolean>;
  markCompactInFlight(threadId: string): void;
  noteOtelCompaction(threadId: string): void;
  handleSdkContextEvent(input: {
    threadId: string;
    eventId: string;
    payload: unknown;
  }): boolean;
}

export function createContextLifecycleService(
  input: ContextLifecycleServiceInput,
): ContextLifecycleService {
  async function schedulePostRunCompactionIfNeeded(
    threadId: string,
    worktreePath: string,
  ): Promise<boolean> {
    if (!input.monitor.shouldCompact(threadId)) {
      return false;
    }
    await input.ensureHeadroom(threadId, worktreePath, new AbortController().signal);
    return true;
  }

  return {
    afterRunRefresh(threadId, worktreePath) {
      input.emitLiveContext(threadId);
      const status = input.getThreadStatus(threadId);
      if (status === "blocked" || status === "failed") {
        return;
      }
      const path = worktreePath ?? input.resolveThreadWorktreePath(threadId);
      if (path) {
        void schedulePostRunCompactionIfNeeded(threadId, path);
      }
    },
    schedulePostRunCompactionIfNeeded,
    markCompactInFlight(threadId) {
      input.monitor.markCompactInFlight(threadId);
    },
    noteOtelCompaction(threadId) {
      input.monitor.noteOtelCompaction(threadId);
    },
    handleSdkContextEvent(event) {
      if (!isRecord(event.payload)) {
        return false;
      }
      const payload = event.payload;
      if (payload.type === "sdk_context_usage" && payload.ecoSdkContextUsage !== undefined) {
        input.applySdkContextUsageBreakdown(event.threadId, payload.ecoSdkContextUsage);
        return true;
      }
      if (payload.subtype === "compact_boundary") {
        input.recordCompactionBoundary(event.threadId, payload, event.eventId);
        const postTokens = extractCompactPostTokens(payload);
        input.monitor.markCompactCompleted(event.threadId, postTokens);
        input.emitLiveContext(event.threadId);
        return false;
      }
      if (payload.type === "system" && payload.subtype === "status" && payload.status === "compacting") {
        input.monitor.noteOtelCompaction(event.threadId);
      }
      return false;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
