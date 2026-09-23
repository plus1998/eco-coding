import type { CoreKind } from "@eco/runtime";
import { CONVERSATION_V2_ERROR } from "@eco/shared";
import { prepareConversationCommandDispatch } from "./conversation-command-dispatch";
import type {
  ConversationCommandCheckpoint,
  ConversationCommandJob,
  ConversationV2Store,
} from "./conversation-v2-store";
import type { RunAttemptCommandDispatch, RunAttemptRecord } from "./usage-ledger";

export type HistoryCommandRecoveryDecision =
  | { kind: "claim"; job: ConversationCommandJob }
  | { kind: "resume_history_side_effects"; job: ConversationCommandJob }
  | { kind: "prepare_runtime_dispatch"; job: ConversationCommandJob }
  | {
      kind: "redispatch_prepared";
      job: ConversationCommandJob;
      plannedAttemptId: string;
      commandDispatch: RunAttemptCommandDispatch;
    }
  | {
      kind: "settle_orphaned_attempt";
      job: ConversationCommandJob;
      attempt: RunAttemptRecord;
      commandDispatch: RunAttemptCommandDispatch;
    }
  | {
      kind: "settle_from_terminal_attempt";
      job: ConversationCommandJob;
      attempt: RunAttemptRecord;
      commandDispatch: RunAttemptCommandDispatch;
    }
  | {
      kind: "integrity_failure";
      job: ConversationCommandJob;
      reason: string;
    };

export function classifyHistoryCommandRecovery(input: {
  job: ConversationCommandJob;
  attempts: readonly RunAttemptRecord[];
}): HistoryCommandRecoveryDecision {
  const { job, attempts } = input;
  if (job.status === "accepted") {
    return { kind: "claim", job };
  }
  const last = job.checkpoints.at(-1);
  if (!last) {
    return integrity(job, "Running command has no execution checkpoint.");
  }
  if (
    last.name === "execution.claimed" &&
    job.commandType === "history.retry" &&
    job.request.rewind === false
  ) {
    return { kind: "prepare_runtime_dispatch", job };
  }
  if (last.name === "history.local_rewrite_committed") {
    return { kind: "prepare_runtime_dispatch", job };
  }
  if (last.name === "history.runtime_dispatch_prepared") {
    const prepared = preparedIdentity(job, last);
    if ("reason" in prepared) return prepared;
    const attempt = attempts.find((candidate) => candidate.attemptId === prepared.plannedAttemptId);
    if (attempt) {
      return integrity(job, "Prepared command already has an attempt but no dispatched checkpoint.");
    }
    return {
      kind: "redispatch_prepared",
      job,
      plannedAttemptId: prepared.plannedAttemptId,
      commandDispatch: prepared.commandDispatch,
    };
  }
  if (last.name === "history.runtime_dispatched") {
    const dispatched = dispatchedIdentity(job, last);
    if ("reason" in dispatched) return dispatched;
    const attempt = attempts.find((candidate) => candidate.attemptId === dispatched.runAttemptId);
    if (!attempt) {
      return integrity(job, "Dispatched command is missing its durable run attempt.");
    }
    const metadataIdentity = commandDispatchFromAttempt(attempt);
    if (!metadataIdentity || !sameDispatch(metadataIdentity, dispatched.commandDispatch)) {
      return integrity(job, "Dispatched command does not match its run attempt metadata.");
    }
    return attempt.status === "running"
      ? {
          kind: "settle_orphaned_attempt",
          job,
          attempt,
          commandDispatch: dispatched.commandDispatch,
        }
      : {
          kind: "settle_from_terminal_attempt",
          job,
          attempt,
          commandDispatch: dispatched.commandDispatch,
        };
  }
  return { kind: "resume_history_side_effects", job };
}

export function recoverNonRewindRetryToPrepared(input: {
  decision: Extract<HistoryCommandRecoveryDecision, { kind: "claim" | "prepare_runtime_dispatch" }>;
  v2: ConversationV2Store;
  coreKind: CoreKind | undefined;
}): Extract<HistoryCommandRecoveryDecision, { kind: "redispatch_prepared" }> | undefined {
  const { decision, v2 } = input;
  if (decision.job.commandType !== "history.retry" || decision.job.request.rewind !== false) {
    return undefined;
  }
  let runningJob = decision.job;
  if (decision.kind === "claim") {
    const claim = v2.beginCommandExecution(
      decision.job.principalId,
      decision.job.conversationId,
      decision.job.clientCommandId,
    );
    if (!claim.acquired) return undefined;
    runningJob = claim.job;
  }
  if (input.coreKind !== "codex" && input.coreKind !== "acp") {
    v2.failCommand(runningJob.principalId, runningJob.conversationId, runningJob.clientCommandId, {
      code: CONVERSATION_V2_ERROR.integrityFailure,
      reason: "Non-rewind retry is owned by an unsupported runtime.",
    });
    return undefined;
  }

  try {
    const prepared = prepareConversationCommandDispatch({
      v2,
      job: runningJob,
      coreKind: input.coreKind,
      actionKind: "non_rewind_retry_recovery",
    });
    const updated = v2.getCommandJob(
      runningJob.principalId,
      runningJob.conversationId,
      runningJob.clientCommandId,
    );
    if (!updated) throw new Error("Prepared non-rewind retry command disappeared.");
    return {
      kind: "redispatch_prepared",
      job: updated,
      plannedAttemptId: prepared.plannedAttemptId,
      commandDispatch: prepared.commandDispatch,
    };
  } catch (error) {
    const current = v2.getCommandJob(
      runningJob.principalId,
      runningJob.conversationId,
      runningJob.clientCommandId,
    );
    if (current?.status === "running") {
      v2.failCommand(runningJob.principalId, runningJob.conversationId, runningJob.clientCommandId, {
        code: CONVERSATION_V2_ERROR.integrityFailure,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    return undefined;
  }
}

function preparedIdentity(
  job: ConversationCommandJob,
  checkpoint: ConversationCommandCheckpoint,
):
  | {
      plannedAttemptId: string;
      commandDispatch: RunAttemptCommandDispatch;
    }
  | Extract<HistoryCommandRecoveryDecision, { kind: "integrity_failure" }> {
  const dispatchId = text(checkpoint.payload.dispatchId);
  const plannedAttemptId = text(checkpoint.payload.plannedAttemptId);
  if (!dispatchId || !plannedAttemptId) {
    return integrity(job, "Prepared command dispatch identity is incomplete.");
  }
  return {
    plannedAttemptId,
    commandDispatch: {
      principalId: job.principalId,
      clientCommandId: job.clientCommandId,
      dispatchId,
    },
  };
}

function dispatchedIdentity(
  job: ConversationCommandJob,
  checkpoint: ConversationCommandCheckpoint,
):
  | { runAttemptId: string; commandDispatch: RunAttemptCommandDispatch }
  | Extract<HistoryCommandRecoveryDecision, { kind: "integrity_failure" }> {
  const dispatchId = text(checkpoint.payload.dispatchId);
  const runAttemptId = text(checkpoint.payload.runAttemptId);
  if (!dispatchId || !runAttemptId) {
    return integrity(job, "Dispatched command identity is incomplete.");
  }
  return {
    runAttemptId,
    commandDispatch: {
      principalId: job.principalId,
      clientCommandId: job.clientCommandId,
      dispatchId,
    },
  };
}

function commandDispatchFromAttempt(attempt: RunAttemptRecord): RunAttemptCommandDispatch | undefined {
  const value = attempt.metadata?.commandDispatch;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const fields = value as Record<string, unknown>;
  const principalId = text(fields.principalId);
  const clientCommandId = text(fields.clientCommandId);
  const dispatchId = text(fields.dispatchId);
  return principalId && clientCommandId && dispatchId
    ? { principalId, clientCommandId, dispatchId }
    : undefined;
}

function sameDispatch(left: RunAttemptCommandDispatch, right: RunAttemptCommandDispatch): boolean {
  return (
    left.principalId === right.principalId &&
    left.clientCommandId === right.clientCommandId &&
    left.dispatchId === right.dispatchId
  );
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integrity(
  job: ConversationCommandJob,
  reason: string,
): Extract<HistoryCommandRecoveryDecision, { kind: "integrity_failure" }> {
  return { kind: "integrity_failure", job, reason };
}
