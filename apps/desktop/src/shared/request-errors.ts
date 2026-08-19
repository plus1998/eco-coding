export function isQuotaOrRateLimitFailure(reason: string): boolean {
  const normalized = reason.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("quota") ||
    normalized.includes("overloaded") ||
    normalized.includes("too many requests") ||
    normalized.includes("insufficient_quota") ||
    (normalized.includes("billing") && normalized.includes("limit"))
  );
}

/**
 * Cursor ACP often ends a turn with only a RetriableError / resource_exhausted
 * envelope as the assistant text (stopReason still end_turn). Treat that as a
 * retryable upstream failure — not a normal completed reply.
 */
export function isRetriableProviderExhaustionMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }
  if (/^(Error:\s*)?RetriableError\b/i.test(trimmed)) {
    return true;
  }
  if (/^(Error:\s*)?ConnectError:\s*\[resource_exhausted\]/i.test(trimmed)) {
    return true;
  }
  if (/^ERROR_RESOURCE_EXHAUSTED\b/i.test(trimmed)) {
    return true;
  }
  // Short whole-message resource_exhausted envelopes without other content.
  if (/\[resource_exhausted\]/i.test(trimmed) && trimmed.length < 240) {
    return true;
  }
  return false;
}
