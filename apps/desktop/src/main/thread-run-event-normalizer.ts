import type {
  ThreadApiErrorInfo,
  ThreadRunBashApprovalMetadata,
  ThreadRunEventInput,
  ThreadRunEventScope,
  ThreadRunEventStreamState,
  ThreadRunToolMetadata,
  ThreadRunEventType,
} from "../shared/ipc";
import { SUBAGENT_ROLES } from "../shared/ipc";
import {
  isThreadFollowUpActivityMessage,
  isThreadFollowUpLiveEvent,
} from "../shared/thread-follow-up-events";

const subagentRoleSet = new Set<string>(SUBAGENT_ROLES);

/** Live events that update billing/context UI but are not narrative run timeline. */
const METRICS_ONLY_THREAD_LIVE_TYPES = new Set([
  "thread.usage_updated",
  "thread.context_updated",
  "thread.subagent_timing_updated",
  "thread.todos_updated",
  "thread.title_updated",
]);

export function isMetricsOnlyThreadLiveEvent(liveType: string): boolean {
  return METRICS_ONLY_THREAD_LIVE_TYPES.has(liveType);
}

export function isMetricsOnlyThreadRunEvent(event: { metadata?: Record<string, unknown> }): boolean {
  const liveType = event.metadata?.liveType;
  return typeof liveType === "string" && METRICS_ONLY_THREAD_LIVE_TYPES.has(liveType);
}

export interface BuildThreadRunEventFromLiveInput {
  threadId: string;
  eventId: string;
  liveType: string;
  message: string;
  role: string;
  stream: boolean;
  observedAt: string;
  runAttemptId?: string;
  agentId?: string;
  streamKey?: string;
  apiError?: ThreadApiErrorInfo;
  tool?: ThreadRunToolMetadata;
  bashApproval?: ThreadRunBashApprovalMetadata;
  metadata?: Record<string, unknown>;
}

export interface BuildSubagentLifecycleRunEventInput {
  threadId: string;
  agentId: string;
  role: string;
  lifecycle: "started" | "stopped" | "abandoned";
  observedAt: string;
  runAttemptId?: string;
  parentAgentId?: string;
  parentToolUseId?: string;
  missionKey?: string;
  todoId?: string;
}

export function buildThreadRunEventFromLiveEvent(
  input: BuildThreadRunEventFromLiveInput,
): ThreadRunEventInput | undefined {
  if (isMetricsOnlyThreadLiveEvent(input.liveType) || isThreadFollowUpLiveEvent(input.liveType)) {
    return undefined;
  }
  if (
    input.liveType.startsWith("thread.") &&
    input.liveType !== "thread.auto_retry" &&
    input.liveType !== "thread.retry" &&
    input.liveType !== "thread.api_error" &&
    input.liveType !== "thread.user_prompt" &&
    isThreadFollowUpActivityMessage(input.message)
  ) {
    return undefined;
  }
  const eventType = resolveThreadRunEventType(input);
  if (!eventType) {
    return undefined;
  }
  const scope = resolveThreadRunEventScope({
    eventType,
    role: input.role,
    ...(input.agentId && { agentId: input.agentId }),
  });
  const streamState = resolveThreadRunEventStreamState(input);
  const requestId = resolveRequestId({
    threadId: input.threadId,
    eventId: input.eventId,
    eventType,
  });

  return {
    id: `tre:${input.eventId}`,
    threadId: input.threadId,
    eventType,
    scope,
    role: input.role,
    streamState,
    message: input.message,
    observedAt: input.observedAt,
    ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
    ...(input.agentId && { agentId: input.agentId }),
    ...(requestId && { requestId }),
    ...(input.streamKey && { streamKey: input.streamKey }),
    metadata: buildLiveEventMetadata(input),
  };
}

export function buildSubagentLifecycleRunEvent(
  input: BuildSubagentLifecycleRunEventInput,
): ThreadRunEventInput {
  const eventType = `agent.${input.lifecycle}` as ThreadRunEventType;
  return {
    id: `tre:${input.threadId}:agent:${input.agentId}:${input.lifecycle}`,
    threadId: input.threadId,
    eventType,
    scope: "agent",
    role: input.role,
    agentId: input.agentId,
    streamState: "none",
    message: `Subagent ${input.role} ${input.lifecycle}`,
    observedAt: input.observedAt,
    ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
    ...(input.parentAgentId && { parentAgentId: input.parentAgentId }),
    ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
    metadata: {
      lifecycle: input.lifecycle,
      ...(input.missionKey && { missionKey: input.missionKey }),
      ...(input.todoId && { todoId: input.todoId }),
    },
  };
}

function resolveThreadRunEventType(input: BuildThreadRunEventFromLiveInput): ThreadRunEventType | undefined {
  if (input.apiError || input.liveType === "thread.api_error") {
    return "api.error";
  }
  if (input.liveType === "tool.started") {
    return "tool.started";
  }
  if (input.liveType === "tool.completed") {
    return "tool.completed";
  }
  if (input.liveType === "tool.failed") {
    return "tool.failed";
  }
  if (input.liveType === "request.started") {
    return "request.started";
  }
  if (input.liveType === "request.retry_scheduled") {
    return "request.retry_scheduled";
  }
  if (input.liveType === "agent.started") {
    return "agent.started";
  }
  if (input.liveType === "message.delta") {
    if (input.role === "thinking") {
      return input.stream ? "thinking.delta" : "thinking.final";
    }
    return input.stream ? "message.delta" : "message.final";
  }
  if (input.liveType === "todo.updated") {
    if (input.tool || /^Tool:/i.test(input.message)) {
      return "tool.started";
    }
    return "thread.status";
  }
  if (input.liveType === "thread.auto_retry" || input.liveType === "thread.retry") {
    return "request.retry_scheduled";
  }
  if (input.liveType === "otel.activity") {
    if (/^Requesting model/i.test(input.message)) {
      return "request.started";
    }
    if (input.tool?.status === "failed") {
      return "tool.failed";
    }
    if (input.tool?.status === "completed") {
      return "tool.completed";
    }
    if (/^Tool failed:/i.test(input.message)) {
      return "tool.failed";
    }
    if (input.tool || /^Tool:/i.test(input.message)) {
      return "tool.completed";
    }
    return input.stream ? "message.delta" : "message.final";
  }
  if (input.liveType.startsWith("thread.")) {
    return "thread.status";
  }
  return input.stream ? "message.delta" : "message.final";
}

function resolveThreadRunEventScope(input: {
  eventType: ThreadRunEventType;
  role: string;
  agentId?: string;
}): ThreadRunEventScope {
  if (input.eventType === "api.error" && input.agentId) {
    return "both";
  }
  if (input.agentId || subagentRoleSet.has(input.role)) {
    return "agent";
  }
  return "main";
}

function resolveThreadRunEventStreamState(
  input: BuildThreadRunEventFromLiveInput,
): ThreadRunEventStreamState {
  if (!input.stream) {
    if (input.liveType === "message.delta") {
      return "finalized";
    }
    return "none";
  }
  return input.message.trim() ? "streaming" : "placeholder";
}

function resolveRequestId(input: {
  threadId: string;
  eventId: string;
  eventType: ThreadRunEventType;
}): string | undefined {
  if (!input.eventType.startsWith("request.") && input.eventType !== "api.error") {
    return undefined;
  }
  return `req:${input.threadId}:${input.eventId}`;
}

function buildLiveEventMetadata(input: BuildThreadRunEventFromLiveInput): Record<string, unknown> {
  const tool = input.tool ? normalizeThreadRunToolMetadata(input.tool) : undefined;
  const bashApproval = input.bashApproval
    ? normalizeThreadRunBashApprovalMetadata(input.bashApproval)
    : undefined;
  return {
    ...(input.metadata ?? {}),
    liveType: input.liveType,
    ...(input.apiError && { apiError: input.apiError }),
    ...(tool && { tool }),
    ...(bashApproval && { bashApproval }),
  };
}

function normalizeThreadRunBashApprovalMetadata(
  bashApproval: ThreadRunBashApprovalMetadata,
): ThreadRunBashApprovalMetadata | undefined {
  const toolUseId = bashApproval.toolUseId.trim();
  const toolName = bashApproval.toolName.trim();
  if (!toolUseId || !toolName) {
    return undefined;
  }
  return {
    toolUseId,
    phase: bashApproval.phase,
    toolName,
    ...(bashApproval.detail?.trim() && { detail: bashApproval.detail.trim() }),
  };
}

function normalizeThreadRunToolMetadata(tool: ThreadRunToolMetadata): ThreadRunToolMetadata | undefined {
  const name = tool.name.trim();
  if (!name) {
    return undefined;
  }
  return {
    name,
    ...(tool.detail?.trim() && { detail: tool.detail.trim() }),
    ...(tool.output?.trim() && { output: tool.output.trim() }),
    ...(tool.toolUseId?.trim() && { toolUseId: tool.toolUseId.trim() }),
    ...(tool.durationMs !== undefined && Number.isFinite(tool.durationMs) && { durationMs: tool.durationMs }),
    ...(isThreadRunToolStatus(tool.status) && { status: tool.status }),
  };
}

function isThreadRunToolStatus(value: unknown): value is NonNullable<ThreadRunToolMetadata["status"]> {
  return value === "started" || value === "completed" || value === "failed";
}
