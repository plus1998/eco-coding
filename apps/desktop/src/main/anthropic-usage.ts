import { StringDecoder } from "node:string_decoder";
import { normalizeOverlappingCacheContextUsage, type ParsedUsage } from "@eco/runtime";

export interface StreamingUsageTracker {
  push(chunk: Uint8Array): void;
  finish(): ParsedUsage | null;
  downstreamMessageId(): string | undefined;
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

function parseRawUsageFromResponseBody(body: unknown): ParsedUsage | null {
  if (!isRecord(body)) {
    return null;
  }
  const usage = isRecord(body.usage) ? body.usage : body;
  const cachedFromDetails = readTokenCount(usage, ["cached_tokens", "cachedTokens"]);
  const details = isRecord(usage.input_tokens_details)
    ? usage.input_tokens_details
    : isRecord(usage.prompt_tokens_details)
      ? usage.prompt_tokens_details
      : null;
  const cachedFromInputDetails =
    details !== null ? readTokenCount(details, ["cached_tokens", "cachedTokens"]) : cachedFromDetails;
  const parsed: ParsedUsage = {
    inputTokens: readTokenCount(usage, ["input_tokens", "inputTokens", "prompt_tokens"]),
    outputTokens: readTokenCount(usage, ["output_tokens", "outputTokens", "completion_tokens"]),
    cacheReadTokens:
      readTokenCount(usage, ["cache_read_input_tokens", "cacheReadInputTokens", "cache_read_tokens"]) ||
      cachedFromInputDetails,
    cacheCreationTokens: readTokenCount(usage, [
      "cache_creation_input_tokens",
      "cacheCreationInputTokens",
      "cache_creation_tokens",
    ]),
  };
  return usageTotal(parsed) > 0 ? parsed : null;
}

export function extractUsageFromResponseBody(body: unknown): ParsedUsage | null {
  const raw = parseRawUsageFromResponseBody(body);
  if (!raw) {
    return null;
  }
  return normalizeOverlappingCacheContextUsage(raw);
}

export function parsedUsageFromOpenAICompatUsage(
  usage:
    | {
        input_tokens?: number;
        output_tokens?: number;
        input_tokens_details?: { cached_tokens?: number | undefined } | undefined;
      }
    | null
    | undefined,
): ParsedUsage | null {
  if (!usage) {
    return null;
  }
  const totalInput = usage.input_tokens ?? 0;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const parsed: ParsedUsage = normalizeOverlappingCacheContextUsage({
    inputTokens: cached > 0 ? Math.max(0, totalInput - cached) : totalInput,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: cached,
    cacheCreationTokens: 0,
  });
  return usageTotal(parsed) > 0 ? parsed : null;
}

export function resolveChatCompletionsStreamUsage(
  trackerUsage: ParsedUsage | null,
  bridgeUsage:
    | {
        input_tokens?: number;
        output_tokens?: number;
        input_tokens_details?: { cached_tokens?: number | undefined } | undefined;
      }
    | undefined,
): ParsedUsage | null {
  if (trackerUsage && usageTotal(trackerUsage) > 0) {
    return normalizeOverlappingCacheContextUsage(trackerUsage);
  }
  const bridgeParsed = parsedUsageFromOpenAICompatUsage(bridgeUsage);
  return bridgeParsed ? normalizeOverlappingCacheContextUsage(bridgeParsed) : null;
}

function extractDownstreamMessageIdFromStreamEvent(event: unknown): string | undefined {
  if (!isRecord(event) || !isRecord(event.message)) {
    return undefined;
  }
  const id = event.message.id;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

function extractRawUsageFromStreamEvent(event: unknown): ParsedUsage | null {
  if (!isRecord(event)) {
    return null;
  }
  if (isRecord(event.message)) {
    const fromMessage = parseRawUsageFromResponseBody(event.message);
    if (fromMessage) {
      return fromMessage;
    }
  }
  return parseRawUsageFromResponseBody(event);
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
  let downstreamMessageId: string | undefined;
  const utf8Decoder = new StringDecoder("utf8");

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
      downstreamMessageId ??= extractDownstreamMessageIdFromStreamEvent(parsed);
      latest = mergeStreamingUsage(latest, extractRawUsageFromStreamEvent(parsed));
    } catch {
      // Ignore malformed SSE chunks.
    }
  };

  return {
    push(chunk) {
      buffer += utf8Decoder.write(Buffer.from(chunk));
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        processBlock(part);
      }
    },
    finish() {
      const tail = utf8Decoder.end();
      if (tail) {
        buffer += tail;
      }
      if (buffer.trim()) {
        processBlock(buffer);
      }
      return latest ? normalizeOverlappingCacheContextUsage(latest) : null;
    },
    downstreamMessageId() {
      return downstreamMessageId;
    },
  };
}
