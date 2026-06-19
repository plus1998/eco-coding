/**
 * Merges streaming text chunks from the agent SDK (Codex-style append-only).
 *
 * Chunks may be cumulative snapshots or incremental deltas. We never guess word
 * boundaries or insert spaces — the model/API owns spacing. Overlap stitching
 * only handles repeated phrase tails (e.g. "of " + "of how").
 */
export function mergeStreamText(previous: string, incoming: string): string {
  if (!incoming) {
    return previous;
  }
  if (!previous) {
    return incoming;
  }
  if (incoming === previous && incoming.length > 1) {
    return previous;
  }
  if (incoming.startsWith(previous) && incoming.length > previous.length) {
    return incoming;
  }
  // Single-char deltas legitimately repeat the previous tail ("160" + "0", "1600x120" + "0").
  if (incoming.length >= 2 && previous.endsWith(incoming)) {
    return previous;
  }

  const overlapped = mergeWithSuffixPrefixOverlap(previous, incoming);
  if (overlapped) {
    return overlapped;
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
