/**
 * Playback position of the reasoning-summary tip's stage carousel.
 *
 * The tip is one live `thinking.delta` row: `reasoningSummaryLabel` re-derives its text on
 * every token, so the stage list the carousel plays keeps changing while it is on screen.
 * Stages are meant to play in order, once each, with the last one holding — which only
 * works if the position survives those updates. Starting over at the first stage whenever
 * the list grew is what made a two-line tip flicker between its stages instead of playing
 * through.
 */

/** How long one stage stays on screen before the next one slides in. */
export const THINKING_CAROUSEL_STAGE_MS = 2600;

/**
 * Where playback sits in `lines` given the list it was playing (`previousLines`) and the
 * stage it had reached (`index`). Stages shared by both lists keep their turn; a list
 * sharing none of them is a different tip, which starts from the first stage.
 */
export function resolveThinkingCarouselIndex(
  previousLines: readonly string[] | null,
  lines: readonly string[],
  index: number,
): number {
  if (!previousLines) {
    return 0;
  }
  const carried = countCarriedStages(previousLines, lines);
  if (carried === 0) {
    return 0;
  }
  // Stages the label's line budget trimmed off the front shift every index down with them.
  return Math.max(0, index - (previousLines.length - carried));
}

/**
 * Longest suffix of `previousLines` that is also a prefix of `lines`: what the two lists
 * share when the tip only grew, or when its older stages have since been trimmed.
 */
function countCarriedStages(previousLines: readonly string[], lines: readonly string[]): number {
  const longest = Math.min(previousLines.length, lines.length);
  for (let length = longest; length > 0; length -= 1) {
    const offset = previousLines.length - length;
    let shared = true;
    for (let step = 0; step < length; step += 1) {
      if (previousLines[offset + step] !== lines[step]) {
        shared = false;
        break;
      }
    }
    if (shared) {
      return length;
    }
  }
  return 0;
}
