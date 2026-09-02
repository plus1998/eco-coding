/** Anthropic message.content block shape (minimal fields Eco needs). */
export interface AnthropicContentBlockLike {
  type: string;
  text?: string | undefined;
  thinking?: string | undefined;
  id?: string | undefined;
  name?: string | undefined;
  input?: unknown | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Gateway occasionally returns one text block whose body is a JSON-serialized content array. */
export function tryParseSerializedAnthropicContentBlocks(text: string): Record<string, unknown>[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[")) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    if (!parsed.every((block) => isRecord(block) && typeof block.type === "string")) {
      return null;
    }
    if (
      !parsed.some((block) => block.type === "text" || block.type === "tool_use" || block.type === "thinking")
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function normalizeAnthropicContentBlocks(
  content: readonly AnthropicContentBlockLike[],
): AnthropicContentBlockLike[] {
  const normalized: AnthropicContentBlockLike[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      const embedded = tryParseSerializedAnthropicContentBlocks(block.text);
      if (embedded) {
        for (const piece of embedded) {
          normalized.push(piece as unknown as AnthropicContentBlockLike);
        }
        continue;
      }
    }
    normalized.push(block);
  }
  return normalized;
}

export function expandAssistantMessageContent(
  content: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const blocks: AnthropicContentBlockLike[] = content
    .filter((block): block is Record<string, unknown> => isRecord(block))
    .map((block) => ({
      type: String(block.type),
      ...(typeof block.text === "string" && { text: block.text }),
      ...(typeof block.thinking === "string" && { thinking: block.thinking }),
      ...(typeof block.id === "string" && { id: block.id }),
      ...(typeof block.name === "string" && { name: block.name }),
      ...(block.input !== undefined && { input: block.input }),
    }));
  return normalizeAnthropicContentBlocks(blocks) as unknown as Record<string, unknown>[];
}
