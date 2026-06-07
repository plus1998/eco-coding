import type {
  ThreadApiErrorInfo,
  ThreadRunEventInput,
  ThreadRunEventScope,
  ThreadRunEventStreamState,
  ThreadRunToolMetadata,
  ThreadRunEventType,
} from "../shared/ipc";
import { SUBAGENT_ROLES } from "../shared/ipc";

const subagentRoleSet = new Set<string>(SUBAGENT_ROLES);

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
    if (/^Tool:/i.test(input.message)) {
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
  return {
    liveType: input.liveType,
    ...(input.apiError && { apiError: input.apiError }),
    ...(tool && { tool }),
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
    ...(tool.toolUseId?.trim() && { toolUseId: tool.toolUseId.trim() }),
    ...(tool.durationMs !== undefined && Number.isFinite(tool.durationMs) && { durationMs: tool.durationMs }),
  };
}
