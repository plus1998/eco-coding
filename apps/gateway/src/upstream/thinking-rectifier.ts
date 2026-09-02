/**
 * Thinking signature rectifier (CC thinking_rectifier.rs).
 * On upstream signature/thinking validation errors, strip thinking blocks and retry once.
 */

export interface ThinkingRectifyResult {
  applied: boolean;
  removedThinkingBlocks: number;
  removedRedactedThinkingBlocks: number;
  removedSignatureFields: number;
}

export function shouldRectifyThinkingSignature(errorMessage: string | undefined): boolean {
  if (errorMessage === undefined || errorMessage === "") {
    return false;
  }
  const lower = errorMessage.toLowerCase();

  if (
    lower.includes("invalid") &&
    lower.includes("signature") &&
    lower.includes("thinking") &&
    lower.includes("block")
  ) {
    return true;
  }

  if (lower.includes("thought signature") && (lower.includes("not valid") || lower.includes("invalid"))) {
    return true;
  }

  if (lower.includes("must start with a thinking block")) {
    return true;
  }

  if (
    lower.includes("expected") &&
    (lower.includes("thinking") || lower.includes("redacted_thinking")) &&
    lower.includes("found") &&
    lower.includes("tool_use")
  ) {
    return true;
  }

  if (lower.includes("signature") && lower.includes("field required")) {
    return true;
  }

  if (lower.includes("signature") && lower.includes("extra inputs are not permitted")) {
    return true;
  }

  if (
    (lower.includes("thinking") || lower.includes("redacted_thinking")) &&
    lower.includes("cannot be modified")
  ) {
    return true;
  }

  if (lower.includes("非法请求") || lower.includes("illegal request") || lower.includes("invalid request")) {
    return true;
  }

  return false;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strip thinking/redacted_thinking blocks and stray signature fields from an Anthropic request body. */
export function rectifyAnthropicRequest(body: JsonRecord): ThinkingRectifyResult {
  const result: ThinkingRectifyResult = {
    applied: false,
    removedThinkingBlocks: 0,
    removedRedactedThinkingBlocks: 0,
    removedSignatureFields: 0,
  };

  const messages = body.messages;
  if (!Array.isArray(messages)) {
    return result;
  }

  for (const msg of messages) {
    if (!isRecord(msg) || !Array.isArray(msg.content)) {
      continue;
    }

    const newContent: unknown[] = [];
    let contentModified = false;

    for (const block of msg.content) {
      if (!isRecord(block)) {
        newContent.push(block);
        continue;
      }

      const blockType = typeof block.type === "string" ? block.type : undefined;
      if (blockType === "thinking") {
        result.removedThinkingBlocks += 1;
        contentModified = true;
        continue;
      }
      if (blockType === "redacted_thinking") {
        result.removedRedactedThinkingBlocks += 1;
        contentModified = true;
        continue;
      }

      if ("signature" in block) {
        const { signature: _sig, ...rest } = block;
        result.removedSignatureFields += 1;
        contentModified = true;
        newContent.push(rest);
        continue;
      }

      newContent.push(block);
    }

    if (contentModified) {
      result.applied = true;
      msg.content = newContent;
    }
  }

  if (shouldRemoveTopLevelThinking(body)) {
    delete body.thinking;
    result.applied = true;
  }

  return result;
}

function shouldRemoveTopLevelThinking(body: JsonRecord): boolean {
  const thinking = body.thinking;
  if (!isRecord(thinking) || thinking.type !== "enabled") {
    return false;
  }

  const messages = body.messages;
  if (!Array.isArray(messages)) {
    return false;
  }

  let lastAssistant: JsonRecord | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (isRecord(msg) && msg.role === "assistant") {
      lastAssistant = msg;
      break;
    }
  }

  if (lastAssistant === undefined || !Array.isArray(lastAssistant.content)) {
    return false;
  }
  const content = lastAssistant.content;
  if (content.length === 0) {
    return false;
  }

  const first = content[0];
  const firstType = isRecord(first) && typeof first.type === "string" ? first.type : undefined;
  if (firstType === "thinking" || firstType === "redacted_thinking") {
    return false;
  }

  return content.some((block) => isRecord(block) && block.type === "tool_use");
}
