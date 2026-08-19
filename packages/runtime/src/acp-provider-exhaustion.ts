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
  // Single-line short envelopes such as `Error: T: [resource_exhausted] Error`.
  if (
    !trimmed.includes("\n") &&
    trimmed.length < 240 &&
    /^(Error:|ConnectError:)/i.test(trimmed) &&
    /\[resource_exhausted\]/i.test(trimmed)
  ) {
    return true;
  }
  return false;
}

/**
 * Split a Cursor ACP assistant payload into optional real body + trailing
 * exhaustion envelope. HAPI: narrative, blank line, then `Error: T: [resource_exhausted]`.
 * Returns null when the message is not an exhaustion envelope (whole or trailing).
 */
export function splitAcpProviderExhaustion(message: string): { body: string; envelope: string } | null {
  const trimmed = message.trim();
  if (!trimmed) {
    return null;
  }
  if (isAcpProviderExhaustionMessage(trimmed)) {
    return { body: "", envelope: trimmed };
  }
  const paragraphs = trimmed.split(/\n\s*\n/);
  if (paragraphs.length >= 2) {
    const last = paragraphs[paragraphs.length - 1]!.trim();
    if (isAcpProviderExhaustionMessage(last)) {
      return { body: paragraphs.slice(0, -1).join("\n\n").trim(), envelope: last };
    }
  }
  const lines = trimmed.split("\n");
  if (lines.length >= 2) {
    const last = lines[lines.length - 1]!.trim();
    if (isAcpProviderExhaustionMessage(last)) {
      return { body: lines.slice(0, -1).join("\n").trim(), envelope: last };
    }
  }
  return null;
}

/**
 * Zero-output ACP failure: no tools, no thinking, and either no agent text
 * or only a provider exhaustion envelope. Callers should discard the turn.
 */
export function isAcpUnstartedProviderFailure(input: {
  agentText: string;
  sawTool: boolean;
  sawThought: boolean;
}): boolean {
  if (input.sawTool || input.sawThought) {
    return false;
  }
  const trimmed = input.agentText.trim();
  return !trimmed || isAcpProviderExhaustionMessage(trimmed);
}
