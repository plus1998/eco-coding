import type { EcoSubagentSessionHooks, SubagentRunPhase } from "@eco/runtime";
import { resolveSubagentSessionRole } from "../shared/subagent-roles.js";
import type { RuntimeAgentRole } from "../shared/ipc";
import type { ConversationStore } from "./conversation-store.js";
import type { AgentLifecycleService } from "./agent-lifecycle-service.js";
import type { SubagentMetricsRegistry } from "./subagent-metrics-registry.js";
import { normalizeSubagentMissionKey } from "./subagent-session-resolve.js";
import { buildSubagentLifecycleRunEvent } from "./thread-run-event-normalizer.js";

export interface PendingSubagentLaunch {
  role: RuntimeAgentRole;
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
    consumePendingLaunch?: (input: { role: RuntimeAgentRole }) => PendingSubagentLaunch | undefined;
    onAgentToolCapture?: (input: { role: RuntimeAgentRole; prompt: string; todoIdHint?: string }) => void;
    onTimingChanged?: () => void;
    onProxyAttributionSettled?: (input: { agentId: string; role: RuntimeAgentRole }) => void;
    onSubagentBillingStamp?: (input: {
      agentId: string;
      role: RuntimeAgentRole;
      parentToolUseId?: string;
      runAttemptId?: string;
    }) => void;
    onSubagentBillingStampClear?: (input: { agentId: string }) => void;
  },
): EcoSubagentSessionHooks {
  return {
    phase,
    threadId,
    onStart(input) {
      const role = resolveSubagentSessionRole(input.agentType) as RuntimeAgentRole | undefined;
      if (!role) {
        return;
      }
      const pending = options?.consumePendingLaunch?.({ role });
      const prompt = input.prompt?.trim() ?? "";
      const todoId = input.todoId ?? pending?.todoId ?? options?.todoIdHint?.();
      const missionKey =
        pending?.missionKey ??
        (role === "coder" && prompt ? normalizeSubagentMissionKey(prompt) : undefined);
      store.upsertSubagentSessionActive({
        threadId,
        role,
        agentId: input.agentId,
        phase,
        ...(todoId && { todoId }),
        ...(missionKey && { missionKey }),
      });
      options?.metricsRegistry?.onSubagentStart(threadId, {
        agentId: input.agentId,
        role,
      });
      options?.onProxyAttributionSettled?.({
        agentId: input.agentId,
        role,
      });
      const lifecycleRecord = options?.lifecycle?.startSubagent({
        threadId,
        agentId: input.agentId,
        role,
        ...(missionKey && { missionKey }),
        ...(todoId && { todoId }),
      });
      appendSubagentLifecycleEvent(store, {
        threadId,
        agentId: input.agentId,
        role,
        lifecycle: "started",
        ...(lifecycleRecord?.runAttemptId && { runAttemptId: lifecycleRecord.runAttemptId }),
        ...(lifecycleRecord?.parentAgentId && { parentAgentId: lifecycleRecord.parentAgentId }),
        ...(lifecycleRecord?.parentToolUseId && { parentToolUseId: lifecycleRecord.parentToolUseId }),
        ...(missionKey && { missionKey }),
        ...(todoId && { todoId }),
      });
      options?.onSubagentBillingStamp?.({
        agentId: input.agentId,
        role,
        ...(lifecycleRecord?.parentToolUseId && { parentToolUseId: lifecycleRecord.parentToolUseId }),
        ...(lifecycleRecord?.runAttemptId && { runAttemptId: lifecycleRecord.runAttemptId }),
      });
      options?.onTimingChanged?.();
    },
    onStop(input) {
      store.markSubagentSessionStopped(threadId, input.agentId);
      const role = resolveSubagentSessionRole(input.agentType) as RuntimeAgentRole | undefined;
      if (role) {
        options?.metricsRegistry?.onSubagentStop(threadId, {
          agentId: input.agentId,
          role,
        });
        options?.lifecycle?.stopSubagent({
          threadId,
          agentId: input.agentId,
          role,
        });
        const runAttemptId = options?.lifecycle?.currentRunAttemptId(threadId);
        appendSubagentLifecycleEvent(store, {
          threadId,
          agentId: input.agentId,
          role,
          lifecycle: "stopped",
          ...(runAttemptId && { runAttemptId }),
        });
        options?.onSubagentBillingStampClear?.({ agentId: input.agentId });
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

function appendSubagentLifecycleEvent(
  store: ConversationStore,
  input: {
    threadId: string;
    agentId: string;
    role: RuntimeAgentRole;
    lifecycle: "started" | "stopped" | "abandoned";
    runAttemptId?: string;
    parentAgentId?: string;
    parentToolUseId?: string;
    missionKey?: string;
    todoId?: string;
  },
): void {
  if (typeof store.appendThreadRunEvent !== "function") {
    return;
  }
  try {
    store.appendThreadRunEvent(
      buildSubagentLifecycleRunEvent({
        ...input,
        observedAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[eco] subagent lifecycle run event failed: ${message}\n`);
  }
}
