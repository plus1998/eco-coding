/**
 * When the renderer re-reads the mutable V2 panel facts (request spans, billing, context).
 *
 * These are normally effect-driven and throttled: they ride on the event stream, and main
 * re-derives request spans on every read, so one fetch per second is enough to keep them current.
 *
 * The exception is the tool-writing fact. While the model writes a tool call's arguments *nothing*
 * else happens on the wire — no V2 effects at all until the arguments are complete — so the fact
 * has no event to ride. Two measured consequences of leaving it on the throttled path, on this
 * endpoint: a 15.8s write whose own trigger was swallowed by the one-second throttle showed the
 * state for 0ms, and the Feed read the whole write as a still timeline.
 */
export function shouldRefreshConversationV2ProjectionExtras(input: {
  hasThreadState: boolean;
  hasProjectionApi: boolean;
  inFlight: boolean;
  now: number;
  nextAllowed: number;
  force?: boolean;
}): boolean {
  if (!input.hasThreadState || !input.hasProjectionApi || input.inFlight) {
    return false;
  }
  return input.force === true || input.now >= input.nextAllowed;
}

/**
 * Live events that change whether a tool call is being written, and therefore have to force the
 * fetch: `tool.writing` announces one, and the call's own row landing (or the turn ending) ends
 * the wait. Dropping `tool.writing` from this set reintroduces the stall silently — nothing else
 * in the stream fires during the write.
 */
export const TOOL_WRITING_REFRESH_LIVE_TYPES: ReadonlySet<string> = new Set([
  "tool.writing",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "thread.completed",
  "thread.failed",
  "thread.cancelled",
  "thread.idle",
  "thread.blocked",
  "thread.execution_failed",
]);
