/**
 * Provider-neutral heuristic text token estimate.
 *
 * Latin-heavy text is approximated at four characters per token, while CJK and
 * other non-ASCII code points count as one token each. It intentionally avoids
 * depending on provider-specific count_tokens/tokenize endpoints. It is not an
 * exact tokenizer result and must not be presented as one.
 */
export function estimateTextTokens(text: string): number {
  if (!text) {
    return 0;
  }
  let asciiChars = 0;
  let nonAsciiCodePoints = 0;
  for (const char of text) {
    if ((char.codePointAt(0) ?? 0) <= 0x7f) {
      asciiChars += 1;
    } else {
      nonAsciiCodePoints += 1;
    }
  }
  return Math.ceil(asciiChars / 4) + nonAsciiCodePoints;
}

/** Heuristic estimate for the countable Anthropic request input fields. */
export function estimateAnthropicRequestTokens(body: Record<string, unknown>): number {
  const parts: string[] = [];
  if (typeof body.system === "string") {
    parts.push(body.system);
  } else if (Array.isArray(body.system)) {
    parts.push(JSON.stringify(body.system));
  }
  if (Array.isArray(body.tools)) {
    parts.push(JSON.stringify(body.tools));
  }
  if (Array.isArray(body.messages)) {
    parts.push(JSON.stringify(body.messages));
  }
  const text = parts.join("\n");
  return text ? Math.max(1, estimateTextTokens(text)) : 0;
}
