import type { PassThrough } from "node:stream";

/** Drain newly written chunks from a paused PassThrough (Bun 1.4+ returns one chunk per read). */
export function drainPassThroughText(stream: PassThrough): string {
  let text = "";
  for (;;) {
    const chunk = stream.read();
    if (chunk === null) {
      break;
    }
    text += chunk.toString();
  }
  return text;
}

export function parseJsonLines(text: string): unknown[] {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function readPassThroughJsonLines(stream: PassThrough): unknown[] {
  return parseJsonLines(drainPassThroughText(stream));
}

export function readRpcMessages(
  stdin: PassThrough,
): Array<{ method?: string; params?: Record<string, unknown>; id?: unknown }> {
  return readPassThroughJsonLines(stdin) as Array<{
    method?: string;
    params?: Record<string, unknown>;
    id?: unknown;
  }>;
}
