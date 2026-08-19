/**
 * Cursor ACP often ends a turn with only a RetriableError / resource_exhausted
 * envelope as the assistant text while still returning stopReason `end_turn`.
 * That must become `run.terminal` failed — not a completed narrative reply.
 */
export function isAcpProviderExhaustionMessage(message: string): boolean {
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
