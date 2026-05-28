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
  if (needsWordSeparator(previous, incoming)) {
    return `${previous} ${incoming}`;
  }
  return `${previous}${incoming}`;
}

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
  return isWordChar(last) && isWordChar(first);
}

function isWordChar(char: string): boolean {
  return /[\p{L}\p{N}]/u.test(char);
}
