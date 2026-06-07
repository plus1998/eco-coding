import type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../shared/ipc";
import {
  resolveSubagentRunDisplayTitle,
  type ActivityActionIcon,
  type ActivityDetailBlock,
} from "./activity-log";

export interface ThreadRunProjectionViewModel {
  showThreadPrompt: boolean;
  mainItemIds: string[];
  subagentCards: ThreadRunProjectionSubagentCard[];
}

export interface ThreadRunProjectionSubagentCard {
  key: string;
  agent: ThreadRunProjectionAgent;
  timelineIds: string[];
  running: boolean;
  statusText?: string;
}

export function buildThreadRunProjectionViewModel(
  projection: ThreadRunProjectionSnapshot,
  thread?: { id: string; prompt: string },
): ThreadRunProjectionViewModel {
  const hasProjectedUserPrompt = projection.timeline.some(isProjectionUserPromptItem);
  const showThreadPrompt = Boolean(thread?.prompt.trim() && !hasProjectedUserPrompt);
  return {
    showThreadPrompt,
    mainItemIds: projection.timeline.map((item) => item.id),
    subagentCards: projection.agents
      .filter((agent) => agent.kind === "subagent")
      .map((agent) => {
        const statusText = resolveProjectionAgentStatusText(agent);
        return {
          key: agent.agentId,
          agent,
          timelineIds: agent.timeline.map((item) => item.id),
          running: agent.status === "active" || agent.status === "launching",
          ...(statusText && { statusText }),
        };
      }),
  };
}

export function projectionItemToDetailBlock(
  item: ThreadRunProjectionTimelineItem,
): ActivityDetailBlock | undefined {
  const text = item.text.trim();

  if (item.eventType === "message.delta" || item.eventType === "message.final") {
    if (!text && item.eventType !== "message.delta") {
      return undefined;
    }
    return {
      kind: "narrative",
      text: item.text,
      streaming: item.eventType === "message.delta",
      ...(item.role && { subagent: item.role }),
      ...(item.agentId && { agentId: item.agentId }),
    };
  }

  if (item.eventType === "thinking.delta" || item.eventType === "thinking.final") {
    return {
      kind: "thinking",
      text: item.text,
      streaming: item.eventType === "thinking.delta",
      ...(item.role && { subagent: item.role }),
      ...(item.agentId && { agentId: item.agentId }),
    };
  }

  if (item.eventType === "request.started") {
    if (item.scope === "agent" || item.agentId) {
      return {
        kind: "agent-request",
        ...(item.role && { subagent: item.role }),
        ...(item.agentId && { agentId: item.agentId }),
      };
    }
    return {
      kind: "model-request",
      ...(item.role && { role: item.role }),
    };
  }

  if (item.eventType === "api.error") {
    const apiError = readProjectionApiError(item);
    return {
      kind: "api-error",
      message: apiError?.message ?? text,
      ...(apiError?.statusCode !== undefined && { statusCode: apiError.statusCode }),
      ...(apiError?.code && { code: apiError.code }),
      ...(item.role && { subagent: item.role }),
      ...(item.agentId && { agentId: item.agentId }),
    };
  }

  if (item.eventType === "tool.failed") {
    return {
      kind: "tool-failed",
      tool: resolveProjectionToolName(item),
      ...(text && { error: text }),
      ...(item.role && { subagent: item.role }),
      ...(item.agentId && { agentId: item.agentId }),
    };
  }

  if (item.eventType === "tool.started" || item.eventType === "tool.completed") {
    return {
      kind: "action",
      icon: resolveProjectionActionIcon(text),
      label: resolveProjectionToolActionLabel(item),
      ...(item.role && { subagent: item.role }),
      ...(item.agentId && { agentId: item.agentId }),
    };
  }

  const phaseLabel = resolveProjectionPhaseLabel(item);
  if (phaseLabel) {
    return { kind: "phase", label: phaseLabel };
  }
  return undefined;
}

export function isProjectionRequestActive(
  span: ThreadRunProjectionSnapshot["requestSpans"][number] | undefined,
): boolean {
  return span?.status === "waiting_first_token" || span?.status === "streaming";
}

export function isProjectionUserPromptItem(item: ThreadRunProjectionTimelineItem): boolean {
  const liveType = projectionLiveType(item);
  return liveType === "thread.user_prompt" || (item.role === "user" && item.text.trim().length > 0);
}

export function resolveProjectionAgentStatusText(
  agent: ThreadRunProjectionAgent,
): string | undefined {
  const latest = agent.latestActivity?.trim();
  if (!latest || isProjectionLifecycleText(latest) || latest === "状态已更新") {
    return undefined;
  }
  return latest;
}

function projectionLiveType(item: ThreadRunProjectionTimelineItem): string | undefined {
  const liveType = item.metadata?.liveType;
  return typeof liveType === "string" ? liveType : undefined;
}

function readProjectionApiError(
  item: ThreadRunProjectionTimelineItem,
): { message: string; statusCode?: number; code?: string } | undefined {
  const raw = item.metadata?.apiError;
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message.trim() : "";
  if (!message) {
    return undefined;
  }
  return {
    message,
    ...(typeof record.statusCode === "number" && { statusCode: record.statusCode }),
    ...(typeof record.code === "string" && record.code.trim() && { code: record.code.trim() }),
  };
}

function isProjectionLifecycleText(text: string): boolean {
  return /^Subagent\s+\S+\s+(started|stopped|abandoned)$/i.test(text);
}

function resolveProjectionPhaseLabel(item: ThreadRunProjectionTimelineItem): string | undefined {
  const text = item.text.trim();
  if (item.eventType === "agent.started") {
    return `${resolveSubagentRunDisplayTitle(item.role ?? "子代理")} 已启动`;
  }
  if (item.eventType === "agent.stopped") {
    return `${resolveSubagentRunDisplayTitle(item.role ?? "子代理")} 已完成`;
  }
  if (item.eventType === "agent.abandoned") {
    return `${resolveSubagentRunDisplayTitle(item.role ?? "子代理")} 已中止`;
  }
  if (item.eventType === "request.retry_scheduled") {
    return text || "准备重试";
  }
  if (item.eventType === "request.completed") {
    return text || "模型请求完成";
  }
  if (item.eventType === "request.failed") {
    return text || "模型请求失败";
  }
  if (item.eventType === "request.cancelled") {
    return text || "模型请求已取消";
  }
  if (item.eventType === "diagnostic") {
    return text || "运行诊断";
  }
  if (item.eventType === "thread.status") {
    if (!text || text === "状态已更新" || isProjectionLifecycleText(text)) {
      return undefined;
    }
    return text;
  }
  return undefined;
}

function resolveProjectionToolName(item: ThreadRunProjectionTimelineItem): string {
  const text = item.text.trim();
  const failedMatch = /^Tool failed:\s*([^:]+)(?::\s*(.*))?$/iu.exec(text);
  if (failedMatch?.[1]?.trim()) {
    return failedMatch[1].trim();
  }
  const toolMatch = /^Tool:\s*([^:]+)(?::\s*(.*))?$/iu.exec(text);
  if (toolMatch?.[1]?.trim()) {
    return toolMatch[1].trim();
  }
  return text || "tool";
}

function resolveProjectionToolActionLabel(item: ThreadRunProjectionTimelineItem): string {
  const text = item.text.trim();
  if (!text) {
    return item.eventType === "tool.completed" ? "工具完成" : "工具调用";
  }
  return text.replace(/^Tool:\s*/iu, "").trim();
}

function resolveProjectionActionIcon(text: string): ActivityActionIcon {
  const lower = text.toLowerCase();
  if (/(search|grep|find|rg|ripgrep)/u.test(lower)) {
    return "search";
  }
  if (/(read|open|cat|list|ls|file)/u.test(lower)) {
    return "file";
  }
  if (/(edit|write|patch|apply)/u.test(lower)) {
    return "edit";
  }
  if (/(bash|shell|terminal|run|exec|command)/u.test(lower)) {
    return "terminal";
  }
  return "agent";
}
