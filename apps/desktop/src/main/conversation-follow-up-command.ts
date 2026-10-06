import { CONVERSATION_V2_ERROR, ConversationV2Error } from "@eco/shared";
import type { ConversationCommandJob, ConversationV2Store } from "./conversation-v2-store";

export interface FollowUpMutationCommandInput {
  principalId: string;
  clientCommandId: string;
  conversationId: string;
  expectedHistoryRevision: number;
  operation: string;
  request: Record<string, unknown>;
}

export interface FollowUpMutationCommandDeps<T> {
  v2: ConversationV2Store;
  execute: () => Promise<T>;
  errorMessage: (error: unknown) => string;
}

/** Persist the follow-up mutation identity before touching queue/runtime state. */
export async function executeFollowUpMutationCommand<T>(
  input: FollowUpMutationCommandInput,
  deps: FollowUpMutationCommandDeps<T>,
): Promise<T> {
  const accepted = deps.v2.acceptCommand({
    principalId: input.principalId,
    conversationId: input.conversationId,
    clientCommandId: input.clientCommandId,
    commandType: "followup.mutate",
    request: { operation: input.operation, ...input.request },
    expectedHistoryRevision: input.expectedHistoryRevision,
  });
  const terminal = terminalResult<T>(accepted, input.operation);
  if (terminal) return terminal;

  const claim = deps.v2.beginCommandExecution(input.principalId, input.conversationId, input.clientCommandId);
  if (!claim.acquired) {
    const existingTerminal = terminalResult<T>(claim.job, input.operation);
    if (existingTerminal) return existingTerminal;
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.integrityFailure,
      "Follow-up mutation is already running with an unknown in-memory outcome.",
    );
  }

  try {
    const value = await deps.execute();
    deps.v2.completeCommand(input.principalId, input.conversationId, input.clientCommandId, {
      ok: true,
      operation: input.operation,
      value,
    });
    return value;
  } catch (error) {
    const current = deps.v2.getCommandJob(input.principalId, input.conversationId, input.clientCommandId);
    if (current?.status === "running") {
      deps.v2.failCommand(input.principalId, input.conversationId, input.clientCommandId, {
        code: error instanceof ConversationV2Error ? error.code : "follow_up_mutation_failed",
        message: deps.errorMessage(error),
      });
    }
    throw error;
  }
}

export function failInterruptedFollowUpCommands(v2: ConversationV2Store): number {
  let failed = 0;
  for (const candidate of v2.listRecoverableCommandJobs().filter((job) => job.commandType === "followup.mutate")) {
    let job = candidate;
    if (job.status === "accepted") {
      const claim = v2.beginCommandExecution(job.principalId, job.conversationId, job.clientCommandId);
      if (!claim.acquired) continue;
      job = claim.job;
    }
    if (job.status !== "running") continue;
    v2.failCommand(job.principalId, job.conversationId, job.clientCommandId, {
      code: "follow_up_outcome_unknown",
      message:
        "The process restarted before the follow-up mutation outcome was durably known; it was not replayed.",
    });
    failed += 1;
  }
  return failed;
}

function terminalResult<T>(job: ConversationCommandJob, operation: string): T | undefined {
  if (job.status === "completed") {
    const result = job.result;
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      (result as Record<string, unknown>).ok !== true ||
      (result as Record<string, unknown>).operation !== operation
    ) {
      throw new ConversationV2Error(
        CONVERSATION_V2_ERROR.integrityFailure,
        "Stored follow-up mutation result is malformed.",
      );
    }
    return (result as Record<string, unknown>).value as T;
  }
  if (job.status === "failed") {
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.integrityFailure,
      `V2 follow-up mutation failed: ${JSON.stringify(job.error)}`,
    );
  }
  return undefined;
}
