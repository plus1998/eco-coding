import type { RowShape } from "./feed-shape";

/**
 * The order a conversation's rows happened in, taken from the legacy log itself.
 *
 * The two chains disagree about where a row goes for reasons that have nothing to do with
 * the log: the legacy merge positions the rows the read models supply by "nearest surviving
 * sibling", and the Feed anchors a tool row at its call's first row (its `tool.started`, or
 * the approval that preceded it) so that a call's row does not jump to the bottom of the
 * feed when its completion arrives. Neither is an oracle for order.
 *
 * The log is: every row in it carries the sequence it was written with, and a rendered row
 * comes from one or more of those rows. Matching a rendered row back to its source rows
 * gives the assertion "the feed draws rows in the order the log recorded them", which is
 * the property the reported defect violated and which survives the old chain's deletion.
 *
 * A message text can repeat (a rewind re-sends the same prompt, a block of reasoning can be
 * re-emitted), so a rendered row matches a *set* of sequences: the caller walks the feed in
 * order and consumes the smallest sequence that is not behind the previous row, the same way
 * the log's own order is recovered from repeated rows.
 */
export interface LegacyOrder {
  /** Source sequences this rendered row could have come from, ascending. */
  candidatesFor(row: RowShape): number[];
}

interface LegacyEventShape {
  sequence?: unknown;
  message?: unknown;
  event_type?: unknown;
  metadata_json?: unknown;
}

export function legacyOrderFor(events: readonly LegacyEventShape[]): LegacyOrder {
  const byCall = new Map<string, number[]>();
  const byText = new Map<string, number[]>();
  for (const event of events) {
    const sequence = typeof event.sequence === "number" ? event.sequence : undefined;
    if (sequence === undefined) continue;
    const metadata = parse(event.metadata_json);
    const tool = metadata?.tool as Record<string, unknown> | undefined;
    const toolUseId = typeof tool?.toolUseId === "string" ? tool.toolUseId.trim() : "";
    if (toolUseId) push(byCall, toolUseId, sequence);
    const message = typeof event.message === "string" ? event.message.trim() : "";
    if (message && isMessageRow(event.event_type)) push(byText, message, sequence);
  }
  return {
    candidatesFor(row) {
      const candidates = row.callId ? byCall.get(row.callId) : byText.get(row.text.trim());
      return candidates ?? [];
    },
  };
}

/**
 * Rows whose `message` column carries the text a rendered row shows.
 *
 * A prompt is written as a `thread.status` row, not as a message row, and it renders as a
 * user row of its own — so it has to be in the index too, or the prompts would be the one
 * part of the feed this assertion cannot see.
 */
function isMessageRow(eventType: unknown): boolean {
  return (
    eventType === "message.delta" ||
    eventType === "message.final" ||
    eventType === "thread.status"
  );
}

function parse(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function push(map: Map<string, number[]>, key: string, sequence: number): void {
  const list = map.get(key) ?? [];
  list.push(sequence);
  map.set(key, list);
}
