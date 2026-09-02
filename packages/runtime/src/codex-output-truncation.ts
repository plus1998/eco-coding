/**
 * Codex-aligned tool-output / middle truncation (codex-rs utils/string + output-truncation).
 * Token estimate for this policy is bytes/4 (ceiling), not Eco's CJK estimateTextTokens.
 */

const APPROX_BYTES_PER_TOKEN = 4;

/** Default model truncation_policy limit from Codex models.json (tokens). */
export const DEFAULT_TOOL_OUTPUT_TOKEN_LIMIT = 10_000;

/** Codex applies policy * 1.2 when recording FunctionCallOutput into history. */
export const TOOL_OUTPUT_SERIALIZATION_BUDGET_MULTIPLIER = 1.2;

export type TruncationPolicy = { mode: "tokens"; limit: number } | { mode: "bytes"; limit: number };

export function toolOutputHistoryPolicy(
  tokenLimit: number = DEFAULT_TOOL_OUTPUT_TOKEN_LIMIT,
): TruncationPolicy {
  const base = Math.max(0, Math.floor(tokenLimit));
  const withBudget = Math.ceil(base * TOOL_OUTPUT_SERIALIZATION_BUDGET_MULTIPLIER);
  return { mode: "tokens", limit: withBudget };
}

export function approxTokenCount(text: string): number {
  const len = byteLength(text);
  return Math.floor((len + APPROX_BYTES_PER_TOKEN - 1) / APPROX_BYTES_PER_TOKEN);
}

export function approxBytesForTokens(tokens: number): number {
  return Math.max(0, Math.floor(tokens)) * APPROX_BYTES_PER_TOKEN;
}

export function approxTokensFromByteCount(bytes: number): number {
  const n = Math.max(0, Math.floor(bytes));
  return Math.floor((n + APPROX_BYTES_PER_TOKEN - 1) / APPROX_BYTES_PER_TOKEN);
}

export function policyByteBudget(policy: TruncationPolicy): number {
  if (policy.mode === "bytes") {
    return Math.max(0, Math.floor(policy.limit));
  }
  return approxBytesForTokens(Math.max(0, Math.floor(policy.limit)));
}

export function policyTokenBudget(policy: TruncationPolicy): number {
  if (policy.mode === "tokens") {
    return Math.max(0, Math.floor(policy.limit));
  }
  return approxTokensFromByteCount(Math.max(0, Math.floor(policy.limit)));
}

/**
 * Middle-truncate to at most `maxTokens` approximate tokens.
 * Returns original string + truncated=false when under limit.
 */
export function truncateMiddleWithTokenBudget(
  text: string,
  maxTokens: number,
): { text: string; truncated: boolean; originalTokenCount?: number } {
  if (!text) {
    return { text: "", truncated: false };
  }
  const budget = Math.max(0, Math.floor(maxTokens));
  if (budget > 0 && byteLength(text) <= approxBytesForTokens(budget)) {
    return { text, truncated: false };
  }
  const truncatedText = truncateWithByteEstimate(text, approxBytesForTokens(budget), true);
  if (truncatedText === text) {
    return { text, truncated: false };
  }
  return {
    text: truncatedText,
    truncated: true,
    originalTokenCount: approxTokenCount(text),
  };
}

export function truncateText(content: string, policy: TruncationPolicy): string {
  if (policy.mode === "bytes") {
    return truncateWithByteEstimate(content, Math.max(0, Math.floor(policy.limit)), false);
  }
  return truncateMiddleWithTokenBudget(content, Math.max(0, Math.floor(policy.limit))).text;
}

/**
 * When over policy.byte_budget, prefix Codex-style warning + middle-truncated body.
 */
export function formattedTruncateText(content: string, policy: TruncationPolicy): string {
  if (byteLength(content) <= policyByteBudget(policy)) {
    return content;
  }
  const originalTokenCount = approxTokenCount(content);
  const totalLines = content.length === 0 ? 0 : content.split(/\r\n|\n|\r/).length;
  const result = truncateText(content, policy);
  return [
    `Warning: truncated output (original token count: ${originalTokenCount})`,
    `Total output lines: ${totalLines}`,
    "",
    result,
  ].join("\n");
}

export interface TruncateToolOutputResult {
  value: unknown;
  text: string;
  truncated: boolean;
}

/**
 * Normalize tool output then apply history truncation policy (tokens * 1.2 by default).
 * String inputs stay strings; non-strings are JSON.stringified before truncation.
 */
export function truncateToolOutputForHistory(
  value: unknown,
  policy: TruncationPolicy = toolOutputHistoryPolicy(),
): TruncateToolOutputResult {
  const text = coerceToolOutputText(value);
  if (byteLength(text) <= policyByteBudget(policy)) {
    // Preserve original string identity when under budget.
    if (typeof value === "string") {
      return { value, text, truncated: false };
    }
    return { value: text, text, truncated: false };
  }
  const formatted = formattedTruncateText(text, policy);
  return { value: formatted, text: formatted, truncated: true };
}

export function coerceToolOutputText(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function byteLength(text: string): number {
  // Codex uses Rust str::len (UTF-8 bytes). Match with TextEncoder.
  return new TextEncoder().encode(text).length;
}

function truncateWithByteEstimate(s: string, maxBytes: number, useTokens: boolean): string {
  if (!s) {
    return "";
  }
  const totalChars = [...s].length;
  if (maxBytes <= 0) {
    return formatTruncationMarker(useTokens, removedUnits(useTokens, byteLength(s), totalChars));
  }
  if (byteLength(s) <= maxBytes) {
    return s;
  }
  const totalBytes = byteLength(s);
  const [leftBudget, rightBudget] = splitBudget(maxBytes);
  const { removedChars, left, right } = splitString(s, leftBudget, rightBudget);
  const marker = formatTruncationMarker(
    useTokens,
    removedUnits(useTokens, totalBytes - maxBytes, removedChars),
  );
  return `${left}${marker}${right}`;
}

function splitBudget(budget: number): [number, number] {
  const left = Math.floor(budget / 2);
  return [left, budget - left];
}

function splitString(
  s: string,
  beginningBytes: number,
  endBytes: number,
): { removedChars: number; left: string; right: string } {
  if (!s) {
    return { removedChars: 0, left: "", right: "" };
  }
  const encoded = new TextEncoder().encode(s);
  const len = encoded.length;
  const tailStartTarget = Math.max(0, len - endBytes);

  // Walk UTF-8 via string char indices mapping to byte offsets.
  let prefixEnd = 0;
  let suffixStart = len;
  let removedChars = 0;
  let suffixStarted = false;
  let byteOffset = 0;

  for (const ch of s) {
    const charBytes = new TextEncoder().encode(ch).length;
    const charEnd = byteOffset + charBytes;
    if (charEnd <= beginningBytes) {
      prefixEnd = charEnd;
      byteOffset = charEnd;
      continue;
    }
    if (byteOffset >= tailStartTarget) {
      if (!suffixStarted) {
        suffixStart = byteOffset;
        suffixStarted = true;
      }
      byteOffset = charEnd;
      continue;
    }
    removedChars += 1;
    byteOffset = charEnd;
  }

  if (suffixStart < prefixEnd) {
    suffixStart = prefixEnd;
  }

  const decoder = new TextDecoder();
  const left = decoder.decode(encoded.subarray(0, prefixEnd));
  const right = decoder.decode(encoded.subarray(suffixStart));
  return { removedChars, left, right };
}

function formatTruncationMarker(useTokens: boolean, removedCount: number): string {
  if (useTokens) {
    return `…${removedCount} tokens truncated…`;
  }
  return `…${removedCount} chars truncated…`;
}

function removedUnits(useTokens: boolean, removedBytes: number, removedChars: number): number {
  if (useTokens) {
    return approxTokensFromByteCount(removedBytes);
  }
  return removedChars;
}
