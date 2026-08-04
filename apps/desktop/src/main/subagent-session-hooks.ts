import type { EcoSubagentAttributionHooks, EcoSubagentSessionHooks, SubagentRunPhase } from "@eco/runtime";
import { summarizeAgentObjective } from "@eco/runtime";
import { resolveSubagentSessionRole } from "../shared/subagent-roles.js";
import type { RuntimeAgentRole } from "../shared/ipc";
import type { ConversationStore } from "./conversation-store.js";
import type { AgentLifecycleService } from "./agent-lifecycle-service.js";
import type { SubagentMetricsRegistry } from "./subagent-metrics-registry.js";
import { normalizeSubagentMissionKey } from "./subagent-session-resolve.js";
import {
  buildSubagentLifecycleRunEvent,
  buildSubagentMissionAttributedRunEvent,
} from "./thread-run-event-normalizer.js";

export function createSubagentSessionHooks(
  store: ConversationStore,
  threadId: string,
  phase: SubagentRunPhase,
  options?: {
    lifecycle?: AgentLifecycleService;
    metricsRegistry?: SubagentMetricsRegistry;
    todoIdHint?: () => string | undefined;
    onTimingChanged?: () => void;
    onSubagentStarted?: (input: {
      agentId: string;
      role: RuntimeAgentRole;
      parentToolUseId?: string;
    }) => void;
    onProxyAttributionSettled?: (input: {
      agentId: string;
      role: RuntimeAgentRole;
      parentToolUseId?: string;
    }) => void;
    onSubagentBillingStamp?: (input: {
      agentId: string;
      role: RuntimeAgentRole;
      parentToolUseId?: string;
      runAttemptId?: string;
    }) => void;
    onSubagentBillingStampClear?: (input: { agentId: string }) => void;
    onTerminalReconciliation?: (input: {
      agentId: string;
      role: RuntimeAgentRole;
      agentTranscriptPath?: string;
      transcriptPath?: string;
    }) => void | Promise<void>;
    attribution?: Pick<EcoSubagentAttributionHooks, "onSubagentRegistered">;
  },
): EcoSubagentSessionHooks {
  const hooks: EcoSubagentSessionHooks = {
    phase,
    threadId,
    onStart(input) {
      const role = resolveSubagentSessionRole(input.agentType) as RuntimeAgentRole | undefined;
      if (!role) {
        return;
      }
      const prompt = input.prompt?.trim() ?? "";
      const todoId = input.todoId?.trim() || undefined;
      const missionKey = role === "coder" && prompt ? normalizeSubagentMissionKey(prompt) : undefined;
      store.upsertSubagentSessionActive({
        threadId,
        role,
        agentId: input.agentId,
        phase,
        ...(todoId && { todoId }),
        ...(missionKey && { missionKey }),
      });
      const parentToolUseId = input.parentToolUseId?.trim() || undefined;
      options?.metricsRegistry?.onSubagentStart(threadId, {
        agentId: input.agentId,
        role,
        ...(parentToolUseId && { parentToolUseId }),
      });
      options?.onProxyAttributionSettled?.({
        agentId: input.agentId,
        role,
        ...(parentToolUseId && { parentToolUseId }),
      });
      const lifecycleRecord = options?.lifecycle?.startSubagent({
        threadId,
        agentId: input.agentId,
        role,
        ...(missionKey && { missionKey }),
        ...(todoId && { todoId }),
        ...(parentToolUseId && { parentToolUseId }),
      });
      options?.onSubagentStarted?.({
        agentId: input.agentId,
        role,
        ...(parentToolUseId && { parentToolUseId }),
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
        ...(prompt && { delegationPrompt: prompt }),
        ...(prompt && { delegationSummary: summarizeAgentObjective(role, prompt) }),
      });
      if (prompt) {
        appendSubagentMissionAttributedEvent(store, {
          threadId,
          agentId: input.agentId,
          role,
          prompt,
          ...(lifecycleRecord?.runAttemptId && { runAttemptId: lifecycleRecord.runAttemptId }),
          ...(parentToolUseId && { parentToolUseId }),
        });
      }
      options?.onSubagentBillingStamp?.({
        agentId: input.agentId,
        role,
        ...(lifecycleRecord?.parentToolUseId && { parentToolUseId: lifecycleRecord.parentToolUseId }),
        ...(lifecycleRecord?.runAttemptId && { runAttemptId: lifecycleRecord.runAttemptId }),
      });
      options?.onTimingChanged?.();
    },
    onDelegationLinked(input) {
      const role = resolveSubagentSessionRole(input.agentType) as RuntimeAgentRole | undefined;
      if (!role) {
        return;
      }
      const prompt = input.prompt.trim();
      const parentToolUseId = input.parentToolUseId.trim();
      const todoId = input.todoId?.trim() || undefined;
      if (!prompt || !parentToolUseId) {
        return;
      }
      const missionKey = role === "coder" && prompt ? normalizeSubagentMissionKey(prompt) : undefined;
      store.upsertSubagentSessionActive({
        threadId,
        role,
        agentId: input.agentId,
        phase,
        ...(todoId && { todoId }),
        ...(missionKey && { missionKey }),
      });
      options?.metricsRegistry?.linkToolUseToAgent(threadId, parentToolUseId, input.agentId);
      options?.attribution?.onSubagentRegistered?.({
        role,
        agentId: input.agentId,
        parentToolUseId,
      });
      options?.lifecycle?.linkSubagentParentToolUse({
        threadId,
        agentId: input.agentId,
        parentToolUseId,
      });
      options?.onSubagentStarted?.({
        agentId: input.agentId,
        role,
        parentToolUseId,
      });
      options?.onProxyAttributionSettled?.({
        agentId: input.agentId,
        role,
        parentToolUseId,
      });
      const runAttemptId = options?.lifecycle?.currentRunAttemptId(threadId);
      appendSubagentMissionAttributedEvent(store, {
        threadId,
        agentId: input.agentId,
        role,
        prompt,
        ...(runAttemptId && { runAttemptId }),
        parentToolUseId,
      });
      options?.onSubagentBillingStamp?.({
        agentId: input.agentId,
        role,
        parentToolUseId,
        ...(runAttemptId && { runAttemptId }),
      });
      options?.onTimingChanged?.();
    },
    async onStop(input) {
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
        await options?.onTerminalReconciliation?.({
          agentId: input.agentId,
          role,
          ...(input.agentTranscriptPath && { agentTranscriptPath: input.agentTranscriptPath }),
          ...(input.transcriptPath && { transcriptPath: input.transcriptPath }),
        });
        options?.onSubagentBillingStampClear?.({ agentId: input.agentId });
      }
      options?.onTimingChanged?.();
    },
    resolveResume(input) {
      return store.resolveResumeAgentId(input);
    },
    ...(options?.todoIdHint && { todoIdHint: options.todoIdHint }),
  };

  return hooks;
}

function appendSubagentMissionAttributedEvent(
  store: ConversationStore,
  input: {
    threadId: string;
    agentId: string;
    role: RuntimeAgentRole;
    prompt: string;
    runAttemptId?: string;
    parentToolUseId?: string;
  },
): void {
  if (typeof store.appendThreadRunEvent !== "function") {
    return;
  }
  try {
    store.appendThreadRunEvent(
      buildSubagentMissionAttributedRunEvent({
        ...input,
        observedAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[eco] subagent mission run event failed: ${message}\n`);
  }
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
    delegationPrompt?: string;
    delegationSummary?: string;
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
