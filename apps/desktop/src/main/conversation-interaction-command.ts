import { CONVERSATION_V2_ERROR, ConversationV2Error } from "@eco/shared";
import type {
  BashApprovalDecision,
  BashApprovalRequest,
  ClarificationAnswers,
  ClarificationRequest,
} from "../shared/ipc";
import type { BashApprovalResolution } from "./bash-approval-bridge";
import type { ConversationCommandJob, ConversationV2Store } from "./conversation-v2-store";

export interface ClarificationResolutionCommandInput {
  principalId: string;
  clientCommandId: string;
  conversationId: string;
  toolUseId: string;
  resolution: "submit" | "dismiss";
  answers?: ClarificationAnswers;
  expectedHistoryRevision: number;
}

export interface ClarificationResolutionCommandDeps {
  v2: ConversationV2Store;
  getPending: (toolUseId: string) => ClarificationRequest | undefined;
  buildDismissAnswers: (request: ClarificationRequest) => ClarificationAnswers;
  resolve: (toolUseId: string, answers: ClarificationAnswers) => boolean;
  errorMessage: (error: unknown) => string;
}

export interface BashApprovalResolutionCommandInput {
  principalId: string;
  clientCommandId: string;
  conversationId: string;
  toolUseId: string;
  decision: BashApprovalDecision;
  feedback?: string;
  expectedHistoryRevision: number;
}

export interface BashApprovalResolutionCommandDeps {
  v2: ConversationV2Store;
  getPending: (toolUseId: string) => BashApprovalRequest | undefined;
  resolve: (toolUseId: string, resolution: BashApprovalResolution) => boolean;
  errorMessage: (error: unknown) => string;
}

export type BashApprovalResolutionCommandResult =
  | { ok: true; alreadyResolved: true }
  | { ok: true; alreadyResolved: false; request: BashApprovalRequest };

export function executeClarificationResolutionCommand(
  input: ClarificationResolutionCommandInput,
  deps: ClarificationResolutionCommandDeps,
): { ok: true } {
  const existing = deps.v2.getCommandJob(input.principalId, input.conversationId, input.clientCommandId);
  const pending = input.answers ? undefined : deps.getPending(input.toolUseId);
  const answers =
    input.answers ??
    storedAnswers(existing) ??
    (pending && pending.threadId === input.conversationId ? deps.buildDismissAnswers(pending) : undefined);
  if (!answers) {
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.invalidParams,
      "No matching pending clarification exists for this conversation.",
    );
  }
  const accepted = deps.v2.acceptCommand({
    principalId: input.principalId,
    conversationId: input.conversationId,
    clientCommandId: input.clientCommandId,
    commandType: "clarification.resolve",
    request: {
      toolUseId: input.toolUseId,
      resolution: input.resolution,
      answers,
    },
    expectedHistoryRevision: input.expectedHistoryRevision,
  });
  const terminal = terminalResult(accepted);
  if (terminal) return terminal;

  const claim = deps.v2.beginCommandExecution(input.principalId, input.conversationId, input.clientCommandId);
  if (!claim.acquired) {
    const existingTerminal = terminalResult(claim.job);
    if (existingTerminal) return existingTerminal;
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.integrityFailure,
      "Clarification resolution is already running with an unknown in-memory outcome.",
    );
  }

  try {
    const currentPending = deps.getPending(input.toolUseId);
    if (!currentPending || currentPending.threadId !== input.conversationId) {
      throw new ConversationV2Error(
        CONVERSATION_V2_ERROR.invalidParams,
        "No matching pending clarification exists for this conversation.",
      );
    }
    if (!deps.resolve(input.toolUseId, answers)) {
      throw new ConversationV2Error(
        CONVERSATION_V2_ERROR.integrityFailure,
        "The pending clarification disappeared before it could be resolved.",
      );
    }
    deps.v2.completeCommand(input.principalId, input.conversationId, input.clientCommandId, {
      ok: true,
      toolUseId: input.toolUseId,
      resolution: input.resolution,
    });
    return { ok: true };
  } catch (error) {
    const current = deps.v2.getCommandJob(input.principalId, input.conversationId, input.clientCommandId);
    if (current?.status === "running") {
      deps.v2.failCommand(input.principalId, input.conversationId, input.clientCommandId, {
        code: error instanceof ConversationV2Error ? error.code : "clarification_resolution_failed",
        message: deps.errorMessage(error),
      });
    }
    throw error;
  }
}

function storedAnswers(job: ConversationCommandJob | undefined): ClarificationAnswers | undefined {
  const value = job?.request.answers;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  if (typeof fields.toolUseId !== "string" || !Array.isArray(fields.selections)) return undefined;
  return value as ClarificationAnswers;
}

export function executeBashApprovalResolutionCommand(
  input: BashApprovalResolutionCommandInput,
  deps: BashApprovalResolutionCommandDeps,
): BashApprovalResolutionCommandResult {
  const accepted = deps.v2.acceptCommand({
    principalId: input.principalId,
    conversationId: input.conversationId,
    clientCommandId: input.clientCommandId,
    commandType: "approval.resolve",
    request: {
      toolUseId: input.toolUseId,
      decision: input.decision,
      ...(input.feedback ? { feedback: input.feedback } : {}),
    },
    expectedHistoryRevision: input.expectedHistoryRevision,
  });
  if (accepted.status === "completed") {
    requireCompletedInteractionResult(accepted, "Bash approval");
    return { ok: true, alreadyResolved: true };
  }
  if (accepted.status === "failed") throwFailedInteraction(accepted, "Bash approval");

  const claim = deps.v2.beginCommandExecution(input.principalId, input.conversationId, input.clientCommandId);
  if (!claim.acquired) {
    if (claim.job.status === "completed") {
      requireCompletedInteractionResult(claim.job, "Bash approval");
      return { ok: true, alreadyResolved: true };
    }
    if (claim.job.status === "failed") throwFailedInteraction(claim.job, "Bash approval");
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.integrityFailure,
      "Bash approval resolution is already running with an unknown in-memory outcome.",
    );
  }

  try {
    const pending = deps.getPending(input.toolUseId);
    if (!pending || pending.threadId !== input.conversationId) {
      throw new ConversationV2Error(
        CONVERSATION_V2_ERROR.invalidParams,
        "No matching pending Bash approval exists for this conversation.",
      );
    }
    const resolution: BashApprovalResolution = {
      decision: input.decision,
      ...(input.feedback ? { feedback: input.feedback } : {}),
    };
    if (!deps.resolve(input.toolUseId, resolution)) {
      throw new ConversationV2Error(
        CONVERSATION_V2_ERROR.integrityFailure,
        "The pending Bash approval disappeared before it could be resolved.",
      );
    }
    deps.v2.completeCommand(input.principalId, input.conversationId, input.clientCommandId, {
      ok: true,
      toolUseId: input.toolUseId,
      decision: input.decision,
    });
    return { ok: true, alreadyResolved: false, request: pending };
  } catch (error) {
    const current = deps.v2.getCommandJob(input.principalId, input.conversationId, input.clientCommandId);
    if (current?.status === "running") {
      deps.v2.failCommand(input.principalId, input.conversationId, input.clientCommandId, {
        code: error instanceof ConversationV2Error ? error.code : "approval_resolution_failed",
        message: deps.errorMessage(error),
      });
    }
    throw error;
  }
}

export function failInterruptedInteractionCommands(v2: ConversationV2Store): number {
  let failed = 0;
  for (const candidate of v2
    .listRecoverableCommandJobs()
    .filter((job) => job.commandType === "clarification.resolve" || job.commandType === "approval.resolve")) {
    let job = candidate;
    if (job.status === "accepted") {
      const claim = v2.beginCommandExecution(job.principalId, job.conversationId, job.clientCommandId);
      if (!claim.acquired) continue;
      job = claim.job;
    }
    if (job.status !== "running") continue;
    v2.failCommand(job.principalId, job.conversationId, job.clientCommandId, {
      code: "interaction_context_lost",
      message:
        "The process restarted before the interaction resolution outcome was durably known; it was not replayed.",
    });
    failed += 1;
  }
  return failed;
}

function terminalResult(job: ConversationCommandJob): { ok: true } | undefined {
  if (job.status === "completed") {
    const result = job.result;
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      (result as Record<string, unknown>).ok !== true
    ) {
      throw new ConversationV2Error(
        CONVERSATION_V2_ERROR.integrityFailure,
        "Stored clarification resolution result is malformed.",
      );
    }
    return { ok: true };
  }
  if (job.status === "failed") {
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.integrityFailure,
      `V2 clarification resolution failed: ${JSON.stringify(job.error)}`,
    );
  }
  return undefined;
}

function requireCompletedInteractionResult(job: ConversationCommandJob, label: string): void {
  const result = job.result;
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    (result as Record<string, unknown>).ok !== true
  ) {
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.integrityFailure,
      `Stored ${label} resolution result is malformed.`,
    );
  }
}

function throwFailedInteraction(job: ConversationCommandJob, label: string): never {
  throw new ConversationV2Error(
    CONVERSATION_V2_ERROR.integrityFailure,
    `V2 ${label} resolution failed: ${JSON.stringify(job.error)}`,
  );
}
