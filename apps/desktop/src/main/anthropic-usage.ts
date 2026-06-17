import type { ParsedUsage } from "@eco/runtime";

export interface StreamingUsageTracker {
  push(chunk: Uint8Array): void;
  finish(): ParsedUsage | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTokenCount(usage: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function usageTotal(usage: ParsedUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

export function extractUsageFromResponseBody(body: unknown): ParsedUsage | null {
  if (!isRecord(body)) {
    return null;
  }
  const usage = isRecord(body.usage) ? body.usage : body;
  const parsed = {
    inputTokens: readTokenCount(usage, ["input_tokens", "inputTokens", "prompt_tokens"]),
    outputTokens: readTokenCount(usage, ["output_tokens", "outputTokens", "completion_tokens"]),
    cacheReadTokens: readTokenCount(usage, [
      "cache_read_input_tokens",
      "cacheReadInputTokens",
      "cache_read_tokens",
    ]),
    cacheCreationTokens: readTokenCount(usage, [
      "cache_creation_input_tokens",
      "cacheCreationInputTokens",
      "cache_creation_tokens",
    ]),
  };
  return usageTotal(parsed) > 0 ? parsed : null;
}

export function parsedUsageFromOpenAICompatUsage(
  usage:
    | {
        input_tokens?: number;
        output_tokens?: number;
        input_tokens_details?: { cached_tokens?: number };
      }
    | null
    | undefined,
): ParsedUsage | null {
  if (!usage) {
    return null;
  }
  const parsed: ParsedUsage = {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    cacheCreationTokens: 0,
  };
  return usageTotal(parsed) > 0 ? parsed : null;
}

export function resolveChatCompletionsStreamUsage(
  trackerUsage: ParsedUsage | null,
  bridgeUsage:
    | {
        input_tokens?: number;
        output_tokens?: number;
        input_tokens_details?: { cached_tokens?: number };
      }
    | undefined,
): ParsedUsage | null {
  if (trackerUsage && usageTotal(trackerUsage) > 0) {
    return trackerUsage;
  }
  return parsedUsageFromOpenAICompatUsage(bridgeUsage);
}

function extractUsageFromStreamEvent(event: unknown): ParsedUsage | null {
  if (!isRecord(event)) {
    return null;
  }
  if (isRecord(event.message)) {
    const fromMessage = extractUsageFromResponseBody(event.message);
    if (fromMessage) {
      return fromMessage;
    }
  }
  return extractUsageFromResponseBody(event);
}

function mergeStreamingUsage(current: ParsedUsage | null, incoming: ParsedUsage | null): ParsedUsage | null {
  if (!incoming) {
    return current;
  }
  if (!current) {
    return incoming;
  }
  return {
    inputTokens: Math.max(current.inputTokens, incoming.inputTokens),
    outputTokens: Math.max(current.outputTokens, incoming.outputTokens),
    cacheReadTokens: Math.max(current.cacheReadTokens, incoming.cacheReadTokens),
    cacheCreationTokens: Math.max(current.cacheCreationTokens, incoming.cacheCreationTokens),
  };
}

export function createStreamingUsageTracker(): StreamingUsageTracker {
  let buffer = "";
  let latest: ParsedUsage | null = null;

  const processBlock = (block: string) => {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());
    if (dataLines.length === 0) {
      return;
    }
    const data = dataLines.join("\n").trim();
    if (!data || data === "[DONE]") {
      return;
    }
    try {
      const parsed = JSON.parse(data) as unknown;
      latest = mergeStreamingUsage(latest, extractUsageFromStreamEvent(parsed));
    } catch {
      // Ignore malformed SSE chunks.
    }
  };

  return {
    push(chunk) {
      buffer += Buffer.from(chunk).toString("utf8");
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        processBlock(part);
      }
    },
    finish() {
      if (buffer.trim()) {
        processBlock(buffer);
      }
      return latest;
    },
  };
}
