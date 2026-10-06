import type {
  PromptImageAttachment,
  ThreadActivityRewindTarget,
  ThreadContinueResult,
  ThreadRewriteFromMessageRequest,
  ThreadRuntimeConfigInput,
  ThreadSummary,
  ThreadUserMessageEditGetResult,
} from "../shared/ipc";
import type { ConversationV2Store } from "./conversation-v2-store";

export interface ConversationRewriteContinuationInput {
  threadId: string;
  prompt: string;
  attachments: PromptImageAttachment[];
  runtimeConfigInput?: ThreadRuntimeConfigInput;
  rewindTarget: ThreadActivityRewindTarget;
  displayPrompt: string;
  historyCommand: {
    principalId: string;
    clientCommandId: string;
  };
}

export interface ConversationRewriteCommandDeps {
  v2: ConversationV2Store;
  requireConversationV2Thread: (threadId: string) => void;
  getThread: (threadId: string) => ThreadSummary | undefined;
  ensureThreadRuntimeConfig: (thread: ThreadSummary) => ThreadSummary;
  getThreadUserMessageEdit: (
    threadId: string,
    activityLineId: string,
  ) => Promise<ThreadUserMessageEditGetResult>;
  startThreadContinuation: (
    input: ConversationRewriteContinuationInput,
  ) => Promise<ThreadContinueResult>;
  errorMessage: (error: unknown) => string;
}

export interface ConversationRewriteCommandOptions {
  commandType?: "history.rewrite" | "history.retry";
  durableRequestExtras?: Readonly<Record<string, unknown>>;
}

/**
 * Executes the durable V2 envelope for a production history rewrite.
 *
 * Boundary parsing stays in the IPC handler. This coordinator owns the ordering that
 * must not drift between production and tests: accept, claim, validate, dispatch, and
 * durably fail any synchronous preparation error while the command is still running.
 */
export async function executeConversationRewriteCommand(
  request: ThreadRewriteFromMessageRequest,
  deps: ConversationRewriteCommandDeps,
  options: ConversationRewriteCommandOptions = {},
): Promise<ThreadContinueResult> {
  const {
    principalId,
    clientCommandId,
    threadId,
    activityLineId,
    prompt,
    expectedHistoryRevision,
  } = request;
  const attachments = request.attachments ?? [];
  const commandType = options.commandType ?? "history.rewrite";

  deps.requireConversationV2Thread(threadId);
  const accepted = deps.v2.acceptCommand({
    principalId,
    conversationId: threadId,
    clientCommandId,
    commandType,
    request: {
      ...options.durableRequestExtras,
      activityLineId,
      prompt,
      attachments,
      ...(request.runtimeConfig ? { runtimeConfig: request.runtimeConfig } : {}),
    },
    expectedHistoryRevision,
  });
  const claim = deps.v2.beginCommandExecution(
    principalId,
    threadId,
    clientCommandId,
  );
  if (!claim.acquired) {
    if (claim.job.status === "failed") {
      throw new Error(
        `V2 history command failed: ${JSON.stringify(claim.job.error)}`,
      );
    }
    const existing = deps.getThread(threadId);
    if (!existing) throw new Error("Thread was not found.");
    return { thread: deps.ensureThreadRuntimeConfig(existing) };
  }

  try {
    const edit = await deps.getThreadUserMessageEdit(
      threadId,
      activityLineId,
    );
    if (edit.capability.status !== "ready") {
      throw new Error(edit.capability.reason ?? "该消息当前不可编辑。");
    }
    const currentRevision = deps.v2.head(threadId).historyRevision;
    if (currentRevision !== expectedHistoryRevision) {
      throw new Error("历史记录已变化，请刷新后再编辑该消息。");
    }
    const target: ThreadActivityRewindTarget = {
      activityLineId,
      ...(edit.upstreamMessageId
        ? { userMessageId: edit.upstreamMessageId }
        : {}),
    };
    return await deps.startThreadContinuation({
      threadId,
      prompt,
      attachments,
      ...(request.runtimeConfig
        ? { runtimeConfigInput: request.runtimeConfig }
        : {}),
      rewindTarget: target,
      displayPrompt: prompt,
      historyCommand: { principalId, clientCommandId },
    });
  } catch (error) {
    const current = deps.v2.getCommandJob(
      accepted.principalId,
      accepted.conversationId,
      accepted.clientCommandId,
    );
    if (current?.status === "running") {
      deps.v2.failCommand(principalId, threadId, clientCommandId, {
        code: "history_rewrite_failed",
        message: deps.errorMessage(error),
      });
    }
    throw error;
  }
}
