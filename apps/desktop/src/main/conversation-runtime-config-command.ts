import { CONVERSATION_V2_ERROR, ConversationV2Error, stableHash } from "@eco/shared";
import type { ConversationCommandJob, ConversationV2Store } from "./conversation-v2-store";

export interface RuntimeConfigMutationCommandInput {
  principalId: string;
  clientCommandId: string;
  conversationId: string;
  expectedHistoryRevision: number;
  request: Record<string, unknown>;
}

export interface RuntimeConfigMutationCommandDeps<T> {
  v2: ConversationV2Store;
  execute: () => Promise<T>;
  errorMessage: (error: unknown) => string;
}

/** Persist the runtime-config mutation identity before changing thread configuration. */
export async function executeRuntimeConfigMutationCommand<T>(
  input: RuntimeConfigMutationCommandInput,
  deps: RuntimeConfigMutationCommandDeps<T>,
): Promise<T> {
  const accepted = deps.v2.acceptCommand({
    principalId: input.principalId,
    conversationId: input.conversationId,
    clientCommandId: input.clientCommandId,
    commandType: "runtime-config.mutate",
    request: input.request,
    expectedHistoryRevision: input.expectedHistoryRevision,
  });
  const terminal = terminalResult<T>(accepted, input.request);
  if (terminal) return terminal;

  const claim = deps.v2.beginCommandExecution(input.principalId, input.conversationId, input.clientCommandId);
  if (!claim.acquired) {
    const existingTerminal = terminalResult<T>(claim.job, input.request);
    if (existingTerminal) return existingTerminal;
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.integrityFailure,
      "Runtime-config mutation is already running with an unknown in-memory outcome.",
    );
  }

  try {
    const value = await deps.execute();
    deps.v2.completeCommand(input.principalId, input.conversationId, input.clientCommandId, {
      ok: true,
      request: input.request,
      value,
    });
    return value;
  } catch (error) {
    const current = deps.v2.getCommandJob(input.principalId, input.conversationId, input.clientCommandId);
    if (current?.status === "running") {
      deps.v2.failCommand(input.principalId, input.conversationId, input.clientCommandId, {
        code: error instanceof ConversationV2Error ? error.code : "runtime_config_mutation_failed",
        message: deps.errorMessage(error),
      });
    }
    throw error;
  }
}

export function failInterruptedRuntimeConfigCommands(v2: ConversationV2Store): number {
  let failed = 0;
  for (const candidate of v2
    .listRecoverableCommandJobs()
    .filter((job) => job.commandType === "runtime-config.mutate")) {
    let job = candidate;
    if (job.status === "accepted") {
      const claim = v2.beginCommandExecution(job.principalId, job.conversationId, job.clientCommandId);
      if (!claim.acquired) continue;
      job = claim.job;
    }
    if (job.status !== "running") continue;
    v2.failCommand(job.principalId, job.conversationId, job.clientCommandId, {
      code: "runtime_config_outcome_unknown",
      message:
        "The process restarted before the runtime-config mutation outcome was durably known; it was not replayed.",
    });
    failed += 1;
  }
  return failed;
}

function terminalResult<T>(job: ConversationCommandJob, request: Record<string, unknown>): T | undefined {
  if (job.status === "completed") {
    const result = job.result;
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      (result as Record<string, unknown>).ok !== true ||
      !sameRequest((result as Record<string, unknown>).request, request)
    ) {
      throw new ConversationV2Error(
        CONVERSATION_V2_ERROR.integrityFailure,
        "Stored runtime-config mutation result is malformed.",
      );
    }
    return (result as Record<string, unknown>).value as T;
  }
  if (job.status === "failed") {
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.integrityFailure,
      `V2 runtime-config mutation failed: ${JSON.stringify(job.error)}`,
    );
  }
  return undefined;
}

function sameRequest(value: unknown, expected: Record<string, unknown>): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    stableHash(value) === stableHash(expected)
  );
}
