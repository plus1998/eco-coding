import type {
  ThreadActivityLine,
  ThreadContextSnapshot,
  ThreadPendingPlan,
} from "../shared/ipc";
import type {
  ThreadCompactionArchiveRecord,
  ThreadSdkSession,
} from "./conversation-store";
import {
  buildCompactionLedgerEvent,
  readCompactionBoundaryMetadata,
} from "./compaction-ledger-events";
import type { UsageLedgerEvent } from "./usage-ledger";

interface PendingCompactionAudit {
  trigger: "auto" | "manual";
  archiveId?: string;
  sessionId?: string;
  preTokens?: number;
}

export interface CompactionAuditServiceInput {
  listActivityLines(threadId: string): ThreadActivityLine[];
  getContextSnapshot(threadId: string): ThreadContextSnapshot | undefined;
  getSdkSession(threadId: string): ThreadSdkSession | undefined;
  getPendingPlan(threadId: string): ThreadPendingPlan | undefined;
  saveCompactionArchive(
    threadId: string,
    input: {
      trigger: "auto" | "manual";
      sessionId?: string;
      payload: Record<string, unknown>;
    },
  ): ThreadCompactionArchiveRecord;
  getRunAttemptId(threadId: string): string | undefined;
  getPlannerAgentId(threadId: string): string | undefined;
  appendLedgerEvents(events: UsageLedgerEvent[]): void;
  emitActivity(threadId: string, message: string): void;
  markCompactInFlight(threadId: string): void;
  writeError(message: string): void;
  nowIso(): string;
  nowMs(): number;
}

export interface CompactionAuditService {
  archiveBeforeCompaction(
    threadId: string,
    input: { trigger: "auto" | "manual"; sessionId?: string },
  ): void;
  recordBoundary(
    threadId: string,
    payload: Record<string, unknown>,
    sourceEventId?: string,
  ): void;
}

export function createCompactionAuditService(
  services: CompactionAuditServiceInput,
): CompactionAuditService {
  const pendingAudits = new Map<string, PendingCompactionAudit>();

  function appendCompactionLedgerEvent(input: {
    threadId: string;
    sourceEventId: string;
    stage: "started" | "completed";
    trigger?: "auto" | "manual";
    sessionId?: string;
    archiveId?: string;
    preTokens?: number;
    postTokens?: number;
    payload?: Record<string, unknown>;
  }): void {
    const runAttemptId = services.getRunAttemptId(input.threadId);
    const plannerAgentId = services.getPlannerAgentId(input.threadId);
    services.appendLedgerEvents([
      buildCompactionLedgerEvent({
        ...input,
        ...(runAttemptId && { runAttemptId }),
        ...(plannerAgentId && { plannerAgentId }),
      }),
    ]);
  }

  function takePendingCompactionAudit(
    threadId: string,
    sessionId?: string,
  ): PendingCompactionAudit | undefined {
    const sessionKey = compactionAuditKey(threadId, sessionId);
    const threadKey = compactionAuditKey(threadId);
    const pending = pendingAudits.get(sessionKey) ?? pendingAudits.get(threadKey);
    pendingAudits.delete(sessionKey);
    pendingAudits.delete(threadKey);
    return pending;
  }

  return {
    archiveBeforeCompaction(threadId, input) {
      try {
        const activityLines = services.listActivityLines(threadId);
        const context = services.getContextSnapshot(threadId);
        const sdkSession = services.getSdkSession(threadId);
        const pendingPlan = services.getPendingPlan(threadId);
        const archive = services.saveCompactionArchive(threadId, {
          trigger: input.trigger,
          ...(input.sessionId && { sessionId: input.sessionId }),
          payload: {
            archivedAt: services.nowIso(),
            activityLineCount: activityLines.length,
            activityLines,
            ...(context && { context }),
            ...(sdkSession && { sdkSession }),
            ...(pendingPlan && {
              pendingPlan: {
                userPrompt: pendingPlan.userPrompt,
                analysis: pendingPlan.analysis,
                plan: pendingPlan.plan,
                workspacePath: pendingPlan.workspacePath,
                worktreePath: pendingPlan.worktreePath,
              },
            }),
          },
        });
        const audit: PendingCompactionAudit = {
          trigger: input.trigger,
          archiveId: archive.id,
          ...(input.sessionId && { sessionId: input.sessionId }),
          ...(context?.occupied !== undefined && { preTokens: context.occupied }),
        };
        pendingAudits.set(compactionAuditKey(threadId, input.sessionId), audit);
        pendingAudits.set(compactionAuditKey(threadId), audit);
        appendCompactionLedgerEvent({
          threadId,
          sourceEventId: `compact:${archive.id}:started`,
          stage: "started",
          trigger: input.trigger,
          ...(input.sessionId && { sessionId: input.sessionId }),
          archiveId: archive.id,
          ...(context?.occupied !== undefined && { preTokens: context.occupied }),
        });
        const triggerLabel = input.trigger === "manual" ? "手动" : "自动";
        services.emitActivity(threadId, `压缩前已归档上下文（${triggerLabel}）`);
        services.markCompactInFlight(threadId);
      } catch (error) {
        services.writeError(
          `[eco] compaction archive failed for ${threadId}: ${errorMessage(error)}\n`,
        );
      }
    },
    recordBoundary(threadId, payload, sourceEventId) {
      const metadata = readCompactionBoundaryMetadata(payload);
      const pending = takePendingCompactionAudit(threadId, metadata.sessionId);
      const trigger = metadata.trigger ?? pending?.trigger;
      const sessionId = metadata.sessionId ?? pending?.sessionId;
      const preTokens = metadata.preTokens ?? pending?.preTokens;
      appendCompactionLedgerEvent({
        threadId,
        sourceEventId: sourceEventId
          ? `compact:${sourceEventId}`
          : `compact:${threadId}:${services.nowMs()}:completed`,
        stage: "completed",
        ...(trigger && { trigger }),
        ...(sessionId && { sessionId }),
        ...(pending?.archiveId && { archiveId: pending.archiveId }),
        ...(preTokens !== undefined && { preTokens }),
        ...(metadata.postTokens !== undefined && { postTokens: metadata.postTokens }),
        ...(metadata.rawMetadata && { payload: metadata.rawMetadata }),
      });
    },
  };
}

function compactionAuditKey(threadId: string, sessionId?: string): string {
  return `${threadId}\u001f${sessionId ?? "thread"}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
