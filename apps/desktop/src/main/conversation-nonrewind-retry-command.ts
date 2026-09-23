import type {
  PromptImageAttachment,
  ThreadContinueResult,
  ThreadRuntimeConfigInput,
  ThreadSummary,
} from "../shared/ipc";
import {
  type PreparedConversationCommandDispatch,
  prepareConversationCommandDispatch,
} from "./conversation-command-dispatch";
import type { ConversationV2Store } from "./conversation-v2-store";

export interface NonRewindRetryCommandInput {
  principalId: string;
  clientCommandId: string;
  threadId: string;
  activityLineId: string;
  prompt: string;
  requestedPrompt: string;
  attachments: PromptImageAttachment[];
  hasImages: boolean;
  expectedHistoryRevision: number;
  runtimeConfig?: ThreadRuntimeConfigInput;
}

export interface NonRewindRetryCommandDeps {
  v2: ConversationV2Store;
  getThread: (threadId: string) => ThreadSummary | undefined;
  ensureThreadRuntimeConfig: (thread: ThreadSummary) => ThreadSummary;
  start: (input: {
    threadId: string;
    prompt: string;
    attachments: PromptImageAttachment[];
    runtimeConfigInput?: ThreadRuntimeConfigInput;
    skipRecordUserPrompt: true;
    displayPrompt: string;
    historyCommand: { principalId: string; clientCommandId: string };
    preparedRuntimeDispatch: PreparedConversationCommandDispatch;
  }) => Promise<ThreadContinueResult>;
  errorMessage: (error: unknown) => string;
}

export async function executeNonRewindRetryCommand(
  input: NonRewindRetryCommandInput,
  deps: NonRewindRetryCommandDeps,
): Promise<ThreadContinueResult> {
  const accepted = deps.v2.acceptCommand({
    principalId: input.principalId,
    conversationId: input.threadId,
    clientCommandId: input.clientCommandId,
    commandType: "history.retry",
    request: {
      rewind: false,
      activityLineId: input.activityLineId,
      prompt: input.prompt,
      requestedPrompt: input.requestedPrompt,
      attachments: input.attachments,
      hasImages: input.hasImages,
      ...(input.runtimeConfig ? { runtimeConfig: input.runtimeConfig } : {}),
    },
    expectedHistoryRevision: input.expectedHistoryRevision,
  });
  const claim = deps.v2.beginCommandExecution(input.principalId, input.threadId, input.clientCommandId);
  if (!claim.acquired) {
    if (claim.job.status === "failed") {
      throw new Error(`V2 history command failed: ${JSON.stringify(claim.job.error)}`);
    }
    const existing = deps.getThread(input.threadId);
    if (!existing) throw new Error("Thread was not found.");
    return { thread: deps.ensureThreadRuntimeConfig(existing) };
  }

  try {
    const thread = deps.getThread(input.threadId);
    if (!thread?.coreKind || (thread.coreKind !== "codex" && thread.coreKind !== "acp")) {
      throw new Error("Non-rewind retry requires a Codex or ACP thread.");
    }
    const prepared = prepareConversationCommandDispatch({
      v2: deps.v2,
      job: accepted,
      coreKind: thread.coreKind,
      actionKind: "non_rewind_retry",
    });
    return await deps.start({
      threadId: input.threadId,
      prompt: input.prompt,
      attachments: input.attachments,
      ...(input.runtimeConfig ? { runtimeConfigInput: input.runtimeConfig } : {}),
      skipRecordUserPrompt: true,
      displayPrompt: input.prompt,
      historyCommand: {
        principalId: input.principalId,
        clientCommandId: input.clientCommandId,
      },
      preparedRuntimeDispatch: prepared,
    });
  } catch (error) {
    const current = deps.v2.getCommandJob(input.principalId, input.threadId, input.clientCommandId);
    if (current?.status === "running") {
      deps.v2.failCommand(input.principalId, input.threadId, input.clientCommandId, {
        code: "history_retry_failed",
        message: deps.errorMessage(error),
      });
    }
    throw error;
  }
}
