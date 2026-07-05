import type { ThreadActivityLine } from "../shared/ipc";
import type { ThreadSdkSession } from "./conversation-store";

export const SDK_ACTIVITY_LINE_PREFIX = "sdk:";

export interface SdkSessionActivityServices {
  getSdkSession(threadId: string): ThreadSdkSession | undefined;
  loadSdk?: () => Promise<SdkSessionActivityModule>;
  writeError?: (message: string) => void;
}

export interface SdkSessionActivityModule {
  getSessionMessages?: (
    sessionId: string,
    options?: {
      dir?: string;
      includeSystemMessages?: boolean;
      limit?: number;
      offset?: number;
    },
  ) => Promise<SdkSessionMessage[]>;
  getSubagentMessages?: (
    sessionId: string,
    agentId: string,
    options?: {
      dir?: string;
      limit?: number;
      offset?: number;
    },
  ) => Promise<SdkSessionMessage[]>;
}

interface SdkSessionMessage {
  type?: string;
  uuid?: string;
  session_id?: string;
  message?: unknown;
  parent_tool_use_id?: string | null;
}

export function sdkActivityLineId(messageUuid: string): string {
  return `${SDK_ACTIVITY_LINE_PREFIX}${messageUuid.trim()}`;
}

export function sdkMessageUuidFromActivityLineId(activityLineId: string): string | undefined {
  const trimmed = activityLineId.trim();
  if (!trimmed.startsWith(SDK_ACTIVITY_LINE_PREFIX)) {
    return undefined;
  }
  const uuid = trimmed.slice(SDK_ACTIVITY_LINE_PREFIX.length).trim();
  return uuid || undefined;
}

export async function listSdkSessionActivityLines(
  threadId: string,
  services: SdkSessionActivityServices,
): Promise<ThreadActivityLine[]> {
  const session = services.getSdkSession(threadId);
  if (!session?.sessionId || !session.cwd) {
    return [];
  }
  try {
    const sdk = services.loadSdk
      ? await services.loadSdk()
      : ((await import("@anthropic-ai/claude-agent-sdk")) as SdkSessionActivityModule);
    if (typeof sdk.getSessionMessages !== "function") {
      return [];
    }
    const messages = await sdk.getSessionMessages(session.sessionId, {
      dir: session.cwd,
      includeSystemMessages: false,
    });
    return messages
      .map((message) => sdkSessionMessageToActivityLine(message))
      .filter((line): line is ThreadActivityLine => line !== undefined);
  } catch (error) {
    services.writeError?.(
      `[eco] failed to read SDK session activity thread=${threadId} session=${session.sessionId}: ${errorMessage(error)}\n`,
    );
    return [];
  }
}

export async function listSdkSubagentActivityLines(
  threadId: string,
  agentId: string,
  services: SdkSessionActivityServices,
): Promise<ThreadActivityLine[]> {
  const session = services.getSdkSession(threadId);
  const subagentId = agentId.trim();
  if (!session?.sessionId || !session.cwd || !subagentId) {
    return [];
  }
  try {
    const sdk = services.loadSdk
      ? await services.loadSdk()
      : ((await import("@anthropic-ai/claude-agent-sdk")) as SdkSessionActivityModule);
    if (typeof sdk.getSubagentMessages !== "function") {
      return [];
    }
    const messages = await sdk.getSubagentMessages(session.sessionId, subagentId, {
      dir: session.cwd,
    });
    return messages
      .map((message) => sdkSessionMessageToActivityLine(message, { agentId: subagentId }))
      .filter((line): line is ThreadActivityLine => line !== undefined);
  } catch (error) {
    services.writeError?.(
      `[eco] failed to read SDK subagent activity thread=${threadId} session=${session.sessionId} agent=${subagentId}: ${errorMessage(error)}\n`,
    );
    return [];
  }
}

export function sdkSessionMessageToActivityLine(
  message: SdkSessionMessage,
  options: { agentId?: string } = {},
): ThreadActivityLine | undefined {
  const uuid = message.uuid?.trim();
  if (!uuid || (message.type !== "user" && message.type !== "assistant")) {
    return undefined;
  }
  const text = extractSdkMessageText(message.message);
  if (!text) {
    return undefined;
  }
  const id = sdkActivityLineId(uuid);
  return {
    id,
    role: message.type,
    message: text,
    ...(options.agentId && { agentId: options.agentId }),
    ...(message.type === "user" && {
      rewindTarget: {
        activityLineId: id,
        userMessageId: uuid,
      },
    }),
  };
}

function extractSdkMessageText(message: unknown): string {
  if (typeof message === "string") {
    return message.trim();
  }
  if (!isRecord(message)) {
    return "";
  }
  const content = message.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const chunks: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) {
      continue;
    }
    if (typeof block.text === "string" && block.text.trim()) {
      chunks.push(block.text.trim());
      continue;
    }
    if (block.type === "text" && typeof block.content === "string" && block.content.trim()) {
      chunks.push(block.content.trim());
    }
  }
  return chunks.join("\n").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
