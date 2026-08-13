function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 1))}…`;
}

function shortRecipientLabel(recipient: string): string {
  const trimmed = recipient.trim();
  if (trimmed.length <= 12) {
    return trimmed;
  }
  return `${trimmed.slice(0, 8)}…`;
}

export interface SendMessageToolInputFields {
  recipient?: string;
  summary?: string;
  message?: string;
}

export interface SendMessageToolResultFields {
  success?: boolean;
  resultMessage?: string;
  resumedAgentId?: string;
}

export function readSendMessageToolInput(input: unknown): SendMessageToolInputFields | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const recipient = readString(input.to) ?? readString(input.recipient);
  const summary = readString(input.summary);
  const message = readString(input.message) ?? readString(input.content);
  if (!recipient && !summary && !message) {
    return undefined;
  }
  return {
    ...(recipient && { recipient }),
    ...(summary && { summary }),
    ...(message && { message }),
  };
}

export function formatSendMessageToolInputSummary(input: unknown): string | undefined {
  const fields = readSendMessageToolInput(input);
  if (!fields) {
    return undefined;
  }
  const headline = fields.summary ?? (fields.message ? truncateText(fields.message, 80) : undefined);
  if (!headline) {
    return fields.recipient ? `→ ${shortRecipientLabel(fields.recipient)}` : undefined;
  }
  return fields.recipient
    ? `→ ${shortRecipientLabel(fields.recipient)} · ${headline}`
    : headline;
}

export function parseSendMessageToolResult(output: unknown): SendMessageToolResultFields | undefined {
  if (typeof output === "string") {
    const trimmed = output.trim();
    if (!trimmed) {
      return undefined;
    }
    try {
      return parseSendMessageToolResult(JSON.parse(trimmed));
    } catch {
      return { resultMessage: trimmed };
    }
  }
  if (!isRecord(output)) {
    return undefined;
  }
  const resultMessage = readString(output.message);
  const resumedAgentId = readString(output.resumedAgentId);
  const success = typeof output.success === "boolean" ? output.success : undefined;
  if (success === undefined && !resultMessage && !resumedAgentId) {
    return undefined;
  }
  return {
    ...(success !== undefined && { success }),
    ...(resultMessage && { resultMessage }),
    ...(resumedAgentId && { resumedAgentId }),
  };
}

export function formatSendMessageToolResultSummary(result: SendMessageToolResultFields): string | undefined {
  if (result.resultMessage) {
    return truncateText(result.resultMessage, 120);
  }
  if (result.resumedAgentId) {
    return `已恢复子代理 ${shortRecipientLabel(result.resumedAgentId)}`;
  }
  if (result.success === true) {
    return "消息已发送";
  }
  if (result.success === false) {
    return "消息发送失败";
  }
  return undefined;
}
