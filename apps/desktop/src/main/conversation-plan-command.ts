import { CONVERSATION_V2_ERROR, ConversationV2Error, stableHash } from "@eco/shared";
import type { ThreadSummary } from "../shared/ipc";
import type {
  ConversationCommandCheckpointName,
  ConversationCommandJob,
  ConversationV2Store,
} from "./conversation-v2-store";
import type { RunAttemptRecord } from "./usage-ledger";

export type PlanCommandCheckpointName = Extract<ConversationCommandCheckpointName, `plan.${string}`>;
export type PlanTerminalCheckpointName = Extract<
  PlanCommandCheckpointName,
  "plan.pending_cleared" | "plan.dismissal_committed"
>;
export type RecordPlanCommandCheckpoint = (
  name: PlanCommandCheckpointName,
  payload?: Record<string, unknown>,
) => void;

export interface PlanResolutionCommandInput {
  principalId: string;
  clientCommandId: string;
  conversationId: string;
  resolution: "approve" | "dismiss";
  expectedHistoryRevision: number;
  request: Record<string, unknown>;
}

export interface PlanResolutionCommandDeps {
  v2: ConversationV2Store;
  freezeContext: () => Record<string, unknown>;
  execute: (
    context: Record<string, unknown>,
    checkpoint: RecordPlanCommandCheckpoint,
  ) => Promise<{ thread?: ThreadSummary }>;
  errorMessage: (error: unknown) => string;
}

export interface PlanResolutionCommandResult {
  thread?: ThreadSummary;
  alreadyResolved: boolean;
}

export interface PlanSnapshotArtifactCheckpoint {
  absolutePath: string;
  relativePath: string;
  contentHash: string;
}

export type InterruptedPlanCommandDecision =
  | { kind: "preserve_accepted"; job: ConversationCommandJob }
  | {
      kind: "complete_terminal_effect";
      job: ConversationCommandJob;
      clearPendingPlan?: boolean;
      terminalCheckpoint?: PlanTerminalCheckpointName;
    }
  | {
      kind: "complete_runtime_dispatch";
      job: ConversationCommandJob;
      attempt: RunAttemptRecord;
      clearPendingPlan: boolean;
    }
  | {
      kind: "fail";
      job: ConversationCommandJob;
      code:
        | "plan_resolution_not_started"
        | "runtime_dispatch_not_started"
        | "plan_resolution_outcome_unknown";
      reason: string;
    }
  | { kind: "integrity_failure"; job: ConversationCommandJob; reason: string };

export async function executePlanResolutionCommand(
  input: PlanResolutionCommandInput,
  deps: PlanResolutionCommandDeps,
): Promise<PlanResolutionCommandResult> {
  const existing = deps.v2.getCommandJob(input.principalId, input.conversationId, input.clientCommandId);
  const durableRequest = existing
    ? storedPlanRequest(existing, input)
    : {
        resolution: input.resolution,
        input: input.request,
        context: deps.freezeContext(),
      };
  const accepted = deps.v2.acceptCommand({
    principalId: input.principalId,
    conversationId: input.conversationId,
    clientCommandId: input.clientCommandId,
    commandType: "plan.resolve",
    request: durableRequest,
    expectedHistoryRevision: input.expectedHistoryRevision,
  });
  if (accepted.status === "completed") {
    return { ...storedPlanResult(accepted), alreadyResolved: true };
  }
  if (accepted.status === "failed") throwFailedPlanCommand(accepted);

  const claim = deps.v2.beginCommandExecution(input.principalId, input.conversationId, input.clientCommandId);
  if (!claim.acquired) {
    if (claim.job.status === "completed") {
      return { ...storedPlanResult(claim.job), alreadyResolved: true };
    }
    if (claim.job.status === "failed") throwFailedPlanCommand(claim.job);
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.integrityFailure,
      "Plan resolution is already running with an unknown outcome.",
    );
  }

  try {
    const context = storedPlanContext(claim.job);
    deps.v2.recordCommandCheckpoint(
      input.principalId,
      input.conversationId,
      input.clientCommandId,
      "plan.context_frozen",
      { contextHash: stableHash(context) },
    );
    const checkpoint: RecordPlanCommandCheckpoint = (name, payload = {}) => {
      deps.v2.recordCommandCheckpoint(
        input.principalId,
        input.conversationId,
        input.clientCommandId,
        name,
        payload,
      );
    };
    const result = await deps.execute(context, checkpoint);
    deps.v2.completeCommand(input.principalId, input.conversationId, input.clientCommandId, {
      ok: true,
      resolution: input.resolution,
      ...(result.thread ? { thread: result.thread } : {}),
    });
    return { ...result, alreadyResolved: false };
  } catch (error) {
    const current = deps.v2.getCommandJob(input.principalId, input.conversationId, input.clientCommandId);
    if (current?.status === "running") {
      deps.v2.failCommand(input.principalId, input.conversationId, input.clientCommandId, {
        code: error instanceof ConversationV2Error ? error.code : "plan_resolution_failed",
        message: deps.errorMessage(error),
      });
    }
    throw error;
  }
}

function storedPlanRequest(
  job: ConversationCommandJob,
  input: PlanResolutionCommandInput,
): Record<string, unknown> {
  const request = job.request;
  if (
    request.resolution !== input.resolution ||
    stableHash(request.input) !== stableHash(input.request) ||
    !request.context ||
    typeof request.context !== "object" ||
    Array.isArray(request.context)
  ) {
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.idempotencyConflict,
      "Plan resolution command id was reused with a different request or malformed frozen context.",
    );
  }
  return request;
}

function storedPlanContext(job: ConversationCommandJob): Record<string, unknown> {
  const context = job.request.context;
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.integrityFailure,
      "Stored plan resolution context is malformed.",
    );
  }
  return context as Record<string, unknown>;
}

/**
 * The request of an accepted command already contains its frozen pending-plan context,
 * so it can remain accepted for an explicit same-command retry. A claimed command may
 * already have crossed a filesystem, bridge, session-mode, or runtime-launch boundary.
 * Recovery only completes a receipt when a terminal local effect or a matching durable
 * runtime attempt proves the approval action happened. Unknown bridge outcomes are never replayed.
 */
export function recoverInterruptedPlanCommands(
  v2: ConversationV2Store,
  getThread: (threadId: string) => ThreadSummary | undefined,
  options: {
    listRunAttempts?: (threadId: string) => readonly RunAttemptRecord[];
    isConversationBlocked?: (threadId: string) => boolean;
    clearPendingPlanForCommand?: (
      threadId: string,
      command: { principalId: string; clientCommandId: string },
      checkpointName: PlanTerminalCheckpointName,
    ) => void;
    verifySnapshotArtifact?: (
      job: ConversationCommandJob,
      artifact: PlanSnapshotArtifactCheckpoint,
    ) => { ok: true } | { ok: false; reason: string };
  } = {},
): { completed: number; failed: number } {
  let completed = 0;
  let failed = 0;
  for (const candidate of v2
    .listRecoverableCommandJobs()
    .filter((job) => job.commandType === "plan.resolve")) {
    if (options.isConversationBlocked?.(candidate.conversationId)) continue;
    const decision = classifyInterruptedPlanCommand(
      candidate,
      options.listRunAttempts?.(candidate.conversationId) ?? [],
    );
    if (decision.kind === "preserve_accepted") continue;
    const job = decision.job;
    if (decision.kind === "complete_terminal_effect" || decision.kind === "complete_runtime_dispatch") {
      const resolution = storedPlanResolution(job);
      if (resolution === "approve") {
        const artifact = storedPlanSnapshotArtifact(job);
        if (!artifact) {
          v2.failCommand(job.principalId, job.conversationId, job.clientCommandId, {
            code: CONVERSATION_V2_ERROR.integrityFailure,
            message: "Approved plan resolution has no complete deterministic snapshot checkpoint.",
          });
          failed += 1;
          continue;
        }
        const verified = options.verifySnapshotArtifact?.(job, artifact);
        if (verified && !verified.ok) {
          v2.failCommand(job.principalId, job.conversationId, job.clientCommandId, {
            code: CONVERSATION_V2_ERROR.integrityFailure,
            message: verified.reason,
          });
          failed += 1;
          continue;
        }
      }
      if (decision.kind === "complete_runtime_dispatch" && decision.clearPendingPlan) {
        options.clearPendingPlanForCommand?.(
          job.conversationId,
          {
            principalId: job.principalId,
            clientCommandId: job.clientCommandId,
          },
          "plan.pending_cleared",
        );
      }
      if (decision.kind === "complete_terminal_effect" && decision.clearPendingPlan) {
        options.clearPendingPlanForCommand?.(
          job.conversationId,
          {
            principalId: job.principalId,
            clientCommandId: job.clientCommandId,
          },
          decision.terminalCheckpoint ?? "plan.pending_cleared",
        );
      }
      const thread = getThread(job.conversationId);
      v2.completeCommand(job.principalId, job.conversationId, job.clientCommandId, {
        ok: true,
        resolution,
        ...(thread ? { thread } : {}),
      });
      completed += 1;
      continue;
    }
    v2.failCommand(job.principalId, job.conversationId, job.clientCommandId, {
      code: decision.kind === "fail" ? decision.code : CONVERSATION_V2_ERROR.integrityFailure,
      message: decision.reason,
    });
    failed += 1;
  }
  return { completed, failed };
}

function storedPlanSnapshotArtifact(job: ConversationCommandJob): PlanSnapshotArtifactCheckpoint | undefined {
  const checkpoint = job.checkpoints.find((candidate) => candidate.name === "plan.snapshot_persisted");
  if (!checkpoint) return undefined;
  const absolutePath = checkpoint.payload.snapshotPath;
  const relativePath = checkpoint.payload.snapshotRelativePath;
  const contentHash = checkpoint.payload.contentHash;
  const hashAlgorithm = checkpoint.payload.hashAlgorithm;
  if (
    typeof absolutePath !== "string" ||
    !absolutePath.trim() ||
    typeof relativePath !== "string" ||
    !relativePath.trim() ||
    typeof contentHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(contentHash) ||
    hashAlgorithm !== "sha256"
  ) {
    return undefined;
  }
  return { absolutePath, relativePath, contentHash };
}

export function classifyInterruptedPlanCommand(
  job: ConversationCommandJob,
  attempts: readonly RunAttemptRecord[],
): InterruptedPlanCommandDecision {
  if (job.commandType !== "plan.resolve") {
    return {
      kind: "integrity_failure",
      job,
      reason: "Plan recovery received a non-plan command.",
    };
  }
  if (job.status === "accepted") return { kind: "preserve_accepted", job };
  if (job.status !== "running") {
    return {
      kind: "integrity_failure",
      job,
      reason: `Plan recovery received a terminal ${job.status} command.`,
    };
  }

  const checkpoint = (name: PlanCommandCheckpointName) =>
    job.checkpoints.find((candidate) => candidate.name === name);
  if (checkpoint("plan.pending_cleared") || checkpoint("plan.dismissal_committed")) {
    return { kind: "complete_terminal_effect", job };
  }

  const dispatched = checkpoint("plan.runtime_dispatched");
  if (dispatched) {
    const prepared = checkpoint("plan.runtime_dispatch_prepared");
    const dispatchId = dispatched.payload.dispatchId;
    const runAttemptId = dispatched.payload.runAttemptId;
    if (
      !prepared ||
      typeof dispatchId !== "string" ||
      typeof runAttemptId !== "string" ||
      prepared.payload.dispatchId !== dispatchId ||
      prepared.payload.plannedAttemptId !== runAttemptId
    ) {
      return {
        kind: "integrity_failure",
        job,
        reason: "Plan runtime dispatch checkpoints do not carry one matching durable identity.",
      };
    }
    const attempt = attempts.find((candidate) => candidate.attemptId === runAttemptId);
    const commandDispatch = attempt?.metadata?.commandDispatch;
    if (
      !attempt ||
      attempt.threadId !== job.conversationId ||
      !commandDispatch ||
      typeof commandDispatch !== "object" ||
      Array.isArray(commandDispatch) ||
      (commandDispatch as Record<string, unknown>).principalId !== job.principalId ||
      (commandDispatch as Record<string, unknown>).clientCommandId !== job.clientCommandId ||
      (commandDispatch as Record<string, unknown>).dispatchId !== dispatchId
    ) {
      return {
        kind: "integrity_failure",
        job,
        reason: "Plan runtime dispatch has no matching durable run attempt.",
      };
    }
    return {
      kind: "complete_runtime_dispatch",
      job,
      attempt,
      clearPendingPlan: !isForcedSubagentPlan(job),
    };
  }

  if (checkpoint("plan.bridge_resolved")) {
    if (checkpoint("plan.bridge_continuation_resumed")) {
      return {
        kind: "complete_terminal_effect",
        job,
        clearPendingPlan: true,
        terminalCheckpoint:
          storedPlanResolution(job) === "approve" ? "plan.pending_cleared" : "plan.dismissal_committed",
      };
    }
    return {
      kind: "fail",
      job,
      code: "plan_resolution_outcome_unknown",
      reason:
        "The plan approval bridge was resolved before restart, but its remaining snapshot and runtime side effects are unknown; the action was not replayed.",
    };
  }
  if (checkpoint("plan.runtime_dispatch_prepared")) {
    return {
      kind: "fail",
      job,
      code: "runtime_dispatch_not_started",
      reason: "The plan command prepared a runtime identity but no matching run attempt was committed.",
    };
  }
  return {
    kind: "fail",
    job,
    code: "plan_resolution_not_started",
    reason: `The process restarted after plan checkpoint ${job.checkpoints.at(-1)?.name ?? "missing"}; no approval delivery or runtime dispatch was durably recorded.`,
  };
}

function isForcedSubagentPlan(job: ConversationCommandJob): boolean {
  const input = job.request.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const target = (input as Record<string, unknown>).executionTarget;
  return Boolean(
    target &&
      typeof target === "object" &&
      !Array.isArray(target) &&
      (target as Record<string, unknown>).kind === "subagent",
  );
}

function storedPlanResolution(job: ConversationCommandJob): "approve" | "dismiss" {
  const resolution = job.request.resolution;
  if (resolution === "approve" || resolution === "dismiss") return resolution;
  throw new ConversationV2Error(
    CONVERSATION_V2_ERROR.integrityFailure,
    "Stored plan resolution request has an invalid resolution.",
  );
}

function storedPlanResult(job: ConversationCommandJob): { thread?: ThreadSummary } {
  const result = job.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw malformedPlanResult();
  }
  const fields = result as Record<string, unknown>;
  if (fields.ok !== true || (fields.resolution !== "approve" && fields.resolution !== "dismiss")) {
    throw malformedPlanResult();
  }
  return fields.thread && typeof fields.thread === "object" ? { thread: fields.thread as ThreadSummary } : {};
}

function malformedPlanResult(): ConversationV2Error {
  return new ConversationV2Error(
    CONVERSATION_V2_ERROR.integrityFailure,
    "Stored plan resolution result is malformed.",
  );
}

function throwFailedPlanCommand(job: ConversationCommandJob): never {
  throw new ConversationV2Error(
    CONVERSATION_V2_ERROR.integrityFailure,
    `V2 plan resolution failed: ${JSON.stringify(job.error)}`,
  );
}
