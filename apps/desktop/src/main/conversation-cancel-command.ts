import { CONVERSATION_V2_ERROR, ConversationV2Error } from "@eco/shared";
import type { ThreadCancelRequest } from "../shared/ipc";
import type { ConversationCommandJob, ConversationV2Store } from "./conversation-v2-store";

export interface ThreadCancelCommandDeps {
  v2: ConversationV2Store;
  cancel: (request: ThreadCancelRequest) => Promise<void>;
  errorMessage: (error: unknown) => string;
}

export type ThreadCancelCommandResult =
  | { ok: true; alreadyCancelled: true }
  | { ok: true; alreadyCancelled: false };

/**
 * Accept and claim cancellation before touching runtime state. A cancelled
 * run has no safe replay operation after a crash, so an interrupted command
 * is failed closed instead of being guessed as successful.
 */
export async function executeThreadCancelCommand(
  input: ThreadCancelRequest,
  deps: ThreadCancelCommandDeps,
): Promise<ThreadCancelCommandResult> {
  const accepted = deps.v2.acceptCommand({
    principalId: input.principalId,
    conversationId: input.threadId,
    clientCommandId: input.clientCommandId,
    commandType: "run.cancel",
    request: {
      threadId: input.threadId,
      ...(input.worktreeDisposition ? { worktreeDisposition: input.worktreeDisposition } : {}),
    },
    expectedHistoryRevision: input.expectedHistoryRevision,
  });
  const terminal = terminalResult(accepted, input.threadId);
  if (terminal) return terminal;

  const claim = deps.v2.beginCommandExecution(input.principalId, input.threadId, input.clientCommandId);
  if (!claim.acquired) {
    const existingTerminal = terminalResult(claim.job, input.threadId);
    if (existingTerminal) return existingTerminal;
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.integrityFailure,
      "Thread cancellation is already running with an unknown in-memory outcome.",
    );
  }

  try {
    await deps.cancel(input);
    deps.v2.completeCommand(input.principalId, input.threadId, input.clientCommandId, {
      ok: true,
      threadId: input.threadId,
    });
    return { ok: true, alreadyCancelled: false };
  } catch (error) {
    const current = deps.v2.getCommandJob(input.principalId, input.threadId, input.clientCommandId);
    if (current?.status === "running") {
      deps.v2.failCommand(input.principalId, input.threadId, input.clientCommandId, {
        code: error instanceof ConversationV2Error ? error.code : "cancel_failed",
        message: deps.errorMessage(error),
      });
    }
    throw error;
  }
}

export function failInterruptedCancelCommands(v2: ConversationV2Store): number {
  let failed = 0;
  for (const candidate of v2.listRecoverableCommandJobs().filter((job) => job.commandType === "run.cancel")) {
    let job = candidate;
    if (job.status === "accepted") {
      const claim = v2.beginCommandExecution(job.principalId, job.conversationId, job.clientCommandId);
      if (!claim.acquired) continue;
      job = claim.job;
    }
    if (job.status !== "running") continue;
    v2.failCommand(job.principalId, job.conversationId, job.clientCommandId, {
      code: "cancel_outcome_unknown",
      message:
        "The process restarted before the cancellation outcome was durably known; the runtime cancellation was not replayed.",
    });
    failed += 1;
  }
  return failed;
}

function terminalResult(
  job: ConversationCommandJob,
  threadId: string,
): ThreadCancelCommandResult | undefined {
  if (job.status === "completed") {
    const result = job.result;
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      (result as Record<string, unknown>).ok !== true ||
      (result as Record<string, unknown>).threadId !== threadId
    ) {
      throw new ConversationV2Error(
        CONVERSATION_V2_ERROR.integrityFailure,
        "Stored thread cancellation result is malformed.",
      );
    }
    return { ok: true, alreadyCancelled: true };
  }
  if (job.status === "failed") {
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.integrityFailure,
      `V2 thread cancellation failed: ${JSON.stringify(job.error)}`,
    );
  }
  return undefined;
}
