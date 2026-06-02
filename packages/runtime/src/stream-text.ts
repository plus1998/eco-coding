/**
 * Merges streaming text chunks from the agent SDK.
 * Chunks may be cumulative snapshots or deltas; word boundaries may omit spaces
 * when thinking/text streams switch roles between activity rows.
 */
export function mergeStreamText(previous: string, incoming: string): string {
  if (!incoming) {
    return previous;
  }
  if (!previous) {
    return incoming;
  }
  if (incoming.startsWith(previous)) {
    return incoming;
  }
  if (previous.endsWith(incoming)) {
    return previous;
  }

  const overlapped = mergeWithSuffixPrefixOverlap(previous, incoming);
  if (overlapped) {
    return overlapped;
  }

  if (needsWordSeparator(previous, incoming)) {
    return `${previous} ${incoming}`;
  }
  return `${previous}${incoming}`;
}

/** When deltas repeat a trailing phrase (e.g. "of " + "of how"), stitch on overlap. */
function mergeWithSuffixPrefixOverlap(previous: string, incoming: string): string | null {
  const max = Math.min(previous.length, incoming.length, 256);
  for (let len = max; len >= 3; len--) {
    if (previous.slice(-len) === incoming.slice(0, len)) {
      return previous + incoming.slice(len);
    }
  }
  return null;
}

/** Common English function words that start a new token when streamed as a delta. */
const STREAM_WORD_BOUNDARY = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "me",
  "of",
  "on",
  "or",
  "the",
  "to",
  "we",
  "with",
]);

function needsWordSeparator(previous: string, incoming: string): boolean {
  const last = previous.at(-1);
  const first = incoming.at(0);
  if (!last || !first) {
    return false;
  }
  if (last === first) {
    return false;
  }
  if (/\s/u.test(last) || /\s/u.test(first)) {
    return false;
  }
  // Only fix missing spaces between Latin word chunks (not CJK or punctuation).
  if (!/[A-Za-z0-9]/.test(last) || !/[A-Za-z0-9]/.test(first)) {
    return false;
  }
  if (looksLikeIdentifierContinuation(previous, incoming)) {
    return false;
  }
  if (looksLikeLowercaseWordContinuation(previous, incoming)) {
    return false;
  }
  return true;
}

/** SDK deltas can split plain lowercase words (sorter → "s" + "orter", modulo → "mod" + "ulo"). */
function looksLikeLowercaseWordContinuation(previous: string, incoming: string): boolean {
  const incomingWord = incoming.match(/^[a-z]+/)?.[0];
  if (!incomingWord) {
    return false;
  }
  const lastWord = previous.match(/[A-Za-z0-9_]+$/)?.[0] ?? "";
  if (!lastWord || lastWord !== lastWord.toLowerCase()) {
    return false;
  }
  if (STREAM_WORD_BOUNDARY.has(incomingWord)) {
    return false;
  }
  if (lastWord.length === 1) {
    return true;
  }
  if (incomingWord.length < 3) {
    return true;
  }
  if (lastWord.length < 3 && incomingWord.length < 5) {
    return true;
  }
  if (lastWord.length < 4 && incomingWord.length < 4) {
    return true;
  }
  return false;
}

function looksLikeIdentifierContinuation(previous: string, incoming: string): boolean {
  const tail = previous.slice(Math.max(0, previous.length - 32));
  if (/[a-z][A-Z]/u.test(tail)) {
    return true;
  }
  if (/[A-Z]$/u.test(previous)) {
    return true;
  }
  if (/[A-Z]/u.test(incoming)) {
    return true;
  }
  if (incoming.length < 2 && /^[a-z0-9]+$/u.test(incoming)) {
    return true;
  }
  return false;
}
