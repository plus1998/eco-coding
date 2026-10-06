/**
 * Clock behind the Composer's floating "still working" dots.
 *
 * Between the two waits the Feed already narrates — a prompt's first output, a request's
 * first token — the agent goes quiet for a third reason: it is writing its next tool call.
 * Tool arguments arrive as `tool.started` records the Feed deliberately drops until
 * `input_complete` (`isSdkToolInputPlaceholder`), so for as long as that takes nothing on
 * screen moves. On a long call the Feed reads as stalled rather than busy.
 *
 * That gap is silence, not a state the projection can name. The tail narrative stays
 * `message.delta` the whole time its tool call is being written — text stops growing but
 * the row never stops streaming — so no flag separates "still typing" from "quiet". The
 * clock therefore runs off the visible Feed itself: the caller passes a signature that
 * changes exactly when rendered content changes, and the indicator turns on once that
 * signature has held still for the delay below.
 */

/** How long the visible Feed must hold still before the dots count as "stalled". */
export const COMPOSER_FLOATING_LOADING_DELAY_MS = 500;

export interface ComposerAgentSilenceClock {
  /** The Feed signature whose age this clock measures. */
  signature: string;
  /** When that signature was first observed — i.e. when the Feed last moved. */
  movedAtMs: number;
}

/**
 * Restart the clock when the Feed moved and leave it alone when it did not. Returns the
 * same object while the signature holds, so callers may advance it on every render.
 */
export function advanceComposerAgentSilenceClock(
  clock: ComposerAgentSilenceClock | undefined,
  signature: string,
  nowMs: number,
): ComposerAgentSilenceClock {
  if (clock && clock.signature === signature) {
    return clock;
  }
  return { signature, movedAtMs: nowMs };
}

export interface ComposerAgentSilenceInput {
  /** The run is live. A settled thread never reports silence. */
  active: boolean;
  /**
   * The Feed has something of its own animating on the tail — its waiting line, or a
   * thinking row still streaming its shimmer. The two never share the screen: that mark
   * narrates a wait the agent has not started working through, these dots narrate work
   * with nothing to show for it yet.
   */
  feedIndicatorVisible: boolean;
  clock: ComposerAgentSilenceClock | undefined;
  nowMs: number;
  delayMs?: number;
}

/** Whether the floating dots belong on screen. */
export function isComposerAgentSilent(input: ComposerAgentSilenceInput): boolean {
  if (!input.active || input.feedIndicatorVisible || !input.clock) {
    return false;
  }
  return input.nowMs - input.clock.movedAtMs >= (input.delayMs ?? COMPOSER_FLOATING_LOADING_DELAY_MS);
}

/** Milliseconds until {@link isComposerAgentSilent} flips for this clock; 0 once it has. */
export function resolveComposerAgentSilenceDelayMs(
  clock: ComposerAgentSilenceClock,
  nowMs: number,
  delayMs = COMPOSER_FLOATING_LOADING_DELAY_MS,
): number {
  return Math.max(0, delayMs - (nowMs - clock.movedAtMs));
}
