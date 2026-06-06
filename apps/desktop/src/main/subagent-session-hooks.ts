import type { EcoSubagentSessionHooks, SubagentRunPhase } from "@eco/runtime";
import { isSubagentRole, type SubagentRole } from "@eco/runtime";
import type { ConversationStore } from "./conversation-store.js";
import type { AgentLifecycleService } from "./agent-lifecycle-service.js";
import type { SubagentMetricsRegistry } from "./subagent-metrics-registry.js";
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
    lifecycle?: AgentLifecycleService;
    metricsRegistry?: SubagentMetricsRegistry;
    todoIdHint?: () => string | undefined;
    consumePendingLaunch?: (input: { role: SubagentRole }) => PendingSubagentLaunch | undefined;
    onAgentToolCapture?: (input: { role: SubagentRole; prompt: string; todoIdHint?: string }) => void;
    onTimingChanged?: () => void;
  },
): EcoSubagentSessionHooks {
  return {
    phase,
    threadId,
    onStart(input) {
      if (!isSubagentRole(input.agentType)) {
        return;
      }
      const pending = options?.consumePendingLaunch?.({ role: input.agentType });
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
      options?.metricsRegistry?.onSubagentStart(threadId, {
        agentId: input.agentId,
        role: input.agentType,
      });
      options?.lifecycle?.startSubagent({
        threadId,
        agentId: input.agentId,
        role: input.agentType,
        ...(missionKey && { missionKey }),
        ...(todoId && { todoId }),
      });
      options?.onTimingChanged?.();
    },
    onStop(input) {
      store.markSubagentSessionStopped(threadId, input.agentId);
      if (isSubagentRole(input.agentType)) {
        options?.metricsRegistry?.onSubagentStop(threadId, {
          agentId: input.agentId,
          role: input.agentType,
        });
        options?.lifecycle?.stopSubagent({
          threadId,
          agentId: input.agentId,
          role: input.agentType,
        });
      }
      options?.onTimingChanged?.();
    },
    resolveResume(input) {
      return store.resolveResumeAgentId(input);
    },
    ...(options?.todoIdHint && { todoIdHint: options.todoIdHint }),
    ...(options?.onAgentToolCapture && { onAgentToolCapture: options.onAgentToolCapture }),
  };
}
