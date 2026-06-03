import type { EcoSubagentSessionHooks, SubagentRunPhase } from "@eco/runtime";
import { isSubagentRole, type SubagentRole } from "@eco/runtime";
import type { ConversationStore } from "./conversation-store.js";
import { normalizeSubagentMissionKey } from "./subagent-session-resolve.js";

export interface PendingSubagentLaunch {
  role: SubagentRole;
  missionKey?: string;
  todoId?: string;
}

export function createSubagentSessionHooks(
  store: ConversationStore,
  threadId: string,
  phase: SubagentRunPhase,
  options?: {
    todoIdHint?: () => string | undefined;
    consumePendingLaunch?: () => PendingSubagentLaunch | undefined;
    onAgentToolCapture?: (input: { role: SubagentRole; prompt: string; todoIdHint?: string }) => void;
  },
): EcoSubagentSessionHooks {
  return {
    phase,
    threadId,
    onStart(input) {
      if (!isSubagentRole(input.agentType)) {
        return;
      }
      const pending = options?.consumePendingLaunch?.();
      const prompt = input.prompt?.trim() ?? "";
      const todoId = input.todoId ?? pending?.todoId ?? options?.todoIdHint?.();
      const missionKey =
        pending?.missionKey ??
        (input.agentType === "coder" && prompt ? normalizeSubagentMissionKey(prompt) : undefined);
      store.upsertSubagentSessionActive({
        threadId,
        role: input.agentType,
        agentId: input.agentId,
        phase,
        ...(todoId && { todoId }),
        ...(missionKey && { missionKey }),
      });
    },
    onStop(input) {
      store.markSubagentSessionStopped(threadId, input.agentId);
    },
    resolveResume(input) {
      return store.resolveResumeAgentId(input);
    },
    ...(options?.todoIdHint && { todoIdHint: options.todoIdHint }),
    ...(options?.onAgentToolCapture && { onAgentToolCapture: options.onAgentToolCapture }),
  };
}
