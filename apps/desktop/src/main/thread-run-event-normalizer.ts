import type {
  ThreadApiErrorInfo,
  ThreadRunEventInput,
  ThreadRunEventScope,
  ThreadRunEventStreamState,
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
  apiError?: ThreadApiErrorInfo;
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
    ...(input.apiError && { metadata: { liveType: input.liveType, apiError: input.apiError } }),
    ...(!input.apiError && { metadata: { liveType: input.liveType } }),
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
    if (/^Tool:/i.test(input.message)) {
      return "tool.started";
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
