import type {
  ConversationStore,
  ThreadDeleteCommandInput,
} from "./conversation-store";

export interface ThreadDeleteCommandResult {
  ok: true;
  alreadyDeleted: boolean;
}

export interface ThreadDeleteCommandCoordinatorDeps {
  conversationStore: ConversationStore;
  cleanupExternalState: (threadId: string) => Promise<void>;
  onDeleted?: (input: { threadId: string; workspacePath: string }) => void;
}

export function createThreadDeleteCommandCoordinator(
  deps: ThreadDeleteCommandCoordinatorDeps,
): (input: ThreadDeleteCommandInput) => Promise<ThreadDeleteCommandResult> {
  const inFlightByCommand = new Map<
    string,
    Promise<{ ok: true; alreadyDeleted: false }>
  >();

  return async (input) => {
    const existing = deps.conversationStore.getThreadDeleteCommand(
      input.principalId,
      input.threadId,
      input.clientCommandId,
    );
    if (existing?.status === "completed") {
      return { ok: true, alreadyDeleted: true };
    }

    const thread = deps.conversationStore.getThread(input.threadId);
    if (!thread) {
      throw new Error("Thread was not found and no matching delete receipt exists.");
    }
    // A matching accepted receipt owns the deletion even if stale runtime
    // state later reports busy. New commands must still pass the busy gate.
    if (!existing && (thread.status === "running" || thread.status === "queued")) {
      throw new Error("请先停止当前运行后再删除对话。");
    }

    deps.conversationStore.acceptThreadDeleteCommand(input);
    const inFlightKey = `${input.principalId}\u0000${input.threadId}\u0000${input.clientCommandId}`;
    const existingInFlight = inFlightByCommand.get(inFlightKey);
    if (existingInFlight) return existingInFlight;

    const execution = (async () => {
      await deps.cleanupExternalState(input.threadId);
      deps.conversationStore.completeThreadDeleteCommand(input);
      deps.onDeleted?.({
        threadId: input.threadId,
        workspacePath: thread.workspacePath,
      });
      return { ok: true as const, alreadyDeleted: false as const };
    })();
    inFlightByCommand.set(inFlightKey, execution);
    try {
      return await execution;
    } finally {
      if (inFlightByCommand.get(inFlightKey) === execution) {
        inFlightByCommand.delete(inFlightKey);
      }
    }
  };
}
