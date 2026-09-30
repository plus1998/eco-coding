import { useEffect, useRef, useState } from "react";

/**
 * Paced reveal for streaming text.
 *
 * The previous implementation revealed a fixed number of graphemes every 200 ms
 * and picked the step from backlog thresholds (4 / 16 / 48 / 96). That couples
 * the visible speed to nothing: a 40 chars/s stream advanced 4 characters per
 * tick while 8 arrived, so the text sat still for ~800 ms and then jumped once
 * the backlog crossed a threshold, and a 200 chars/s stream alternated 48 / 48 /
 * 16 character jumps. The stutter people see is produced by that oscillation,
 * not by rendering cost.
 *
 * This pacer instead locks the *visible rate* to the observed arrival rate and
 * keeps a fixed small latency, so characters appear in small, even steps:
 *
 * - visible speed == arrival speed (measured with a smoothed rate estimate),
 * - a bounded lag target, with any excess drained smoothly instead of in jumps,
 * - a tick interval chosen from the measured cost of the last document build, so
 *   the reveal runs at frame rate when the work is cheap and backs off only when
 *   a build actually needs the time.
 */

/** Fastest tick: one reveal per animation frame. */
export const STREAM_TICK_MIN_MS = 16;
/** Slowest tick: the pacer degrades to coarse steps only when builds are expensive. */
export const STREAM_TICK_MAX_MS = 120;
/**
 * Time constant for catching up on a backlog. Proportional catch-up (rather
 * than "finish the excess in exactly `excess` ms") is what keeps the visible
 * speed continuous: a small jitter is corrected gently, and a large clump
 * accelerates only as far as the step cap allows. A fixed window would instead
 * make a tiny excess snap and a large one crawl.
 */
export const STREAM_CATCH_UP_MS = 600;
/**
 * How far behind the arrived text the reveal is allowed to sit.
 *
 * This is a buffer, not a delay on the stream's own pace: at low rates the
 * pending text is only a character or two, so the reveal is effectively live.
 * It only becomes a real lag on fast streams, where holding one network chunk
 * interval (chunks usually arrive every 20-200 ms) absorbs arrival jitter so the
 * visible speed stays constant instead of following every network hiccup.
 * The only visible cost is a one-off snap of at most this much text when a turn
 * ends while the reveal is still behind.
 */
export const STREAM_REVEAL_TARGET_LAG_MS = 200;
/**
 * Hard ceiling on a single tick's reveal, as a multiple of the steady-state step.
 * Catching up is allowed to move faster than the stream, but never so fast that
 * one frame contains a visible wall of new text: the cap turns an unbounded
 * drain into a fast flow that still reads line by line.
 */
export const STREAM_MAX_STEP_FRAMES = 8;
/** Upper bound on a single estimated rate sample, so one big burst cannot spike it. */
export const STREAM_MAX_INSTANT_RATE = 3_000;
/** Weight of a new rate sample. */
export const STREAM_RATE_SMOOTHING = 0.3;
/** Floor on the rate used by the reveal math, so an idle-but-dirty queue still drains. */
export const STREAM_MIN_RATE = 24;
/** Arrival samples kept for rate estimation. */
const RATE_WINDOW_MS = 900;

const graphemeSegmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/**
 * Tick interval for a measured per-build cost.
 *
 * A build is only part of the frame it lands in (ProseMirror has to diff and
 * patch the DOM afterwards), so the budget multiplies the measurement before
 * deciding to slow down.
 */
export function resolveStreamTickMs(lastWorkMs: number): number {
  if (!Number.isFinite(lastWorkMs) || lastWorkMs <= 0) {
    return STREAM_TICK_MIN_MS;
  }
  const budgeted = Math.round(lastWorkMs * 6);
  return Math.min(STREAM_TICK_MAX_MS, Math.max(STREAM_TICK_MIN_MS, budgeted));
}

/** Blend a new rate sample into the smoothed arrival rate. */
export function updateArrivalRate(previousRate: number, instantRate: number): number {
  const sample = Math.min(Math.max(instantRate, 0), STREAM_MAX_INSTANT_RATE);
  if (!(previousRate > 0)) {
    return sample;
  }
  return previousRate * (1 - STREAM_RATE_SMOOTHING) + sample * STREAM_RATE_SMOOTHING;
}

export interface ArrivalSample {
  at: number;
  chars: number;
}

/**
 * Rate in characters/second over the recent window. Returns `null` when there
 * is not enough history to say anything.
 */
export function estimateArrivalRate(samples: readonly ArrivalSample[]): number | null {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) {
    return null;
  }
  const elapsedMs = last.at - first.at;
  if (elapsedMs < 1) {
    return null;
  }
  return Math.max(0, ((last.chars - first.chars) / elapsedMs) * 1000);
}

export interface StreamRevealStep {
  /** Code units to reveal this tick. */
  take: number;
  /** Fractional remainder carried into the next tick. */
  carry: number;
}

/**
 * How much text to reveal this tick.
 *
 * `pending` and `rate` are in code units; the rate is the arrival speed, so
 * revealing at exactly `rate` keeps the lag constant instead of oscillating.
 */
export function resolveStreamReveal(input: {
  pending: number;
  rate: number;
  dtMs: number;
  carry: number;
}): StreamRevealStep {
  const pending = Math.max(0, input.pending);
  const dtMs = Math.max(1, input.dtMs);
  if (pending <= 0) {
    return { take: 0, carry: 0 };
  }
  const rate = Math.max(STREAM_MIN_RATE, input.rate);
  // Characters allowed to sit unrevealed: the smoothing buffer that absorbs
  // arrival jitter without ever letting the text fall meaningfully behind.
  const buffered = (rate * STREAM_REVEAL_TARGET_LAG_MS) / 1000;
  const excess = Math.max(0, pending - buffered);
  const catchUpRate = excess > 0 ? (excess / STREAM_CATCH_UP_MS) * 1000 : 0;
  const steadyStep = (rate * dtMs) / 1000;
  const maxStep = Math.max(2, steadyStep * STREAM_MAX_STEP_FRAMES);
  const advanced = input.carry + steadyStep + (catchUpRate * dtMs) / 1000;
  const budgeted = Math.min(advanced, maxStep);
  const take = Math.min(pending, Math.floor(budgeted));
  return { take, carry: Math.min(0.99, Math.max(0, budgeted - take)) };
}

/**
 * Code units to reveal starting at `from` to cover at least `wanted` units,
 * without splitting a grapheme cluster or a surrogate pair.
 */
export function takeStreamUnits(text: string, from: number, wanted: number): number {
  if (wanted <= 0 || from >= text.length) {
    return 0;
  }
  const rest = text.slice(from);
  if (!graphemeSegmenter) {
    let end = Math.min(wanted, rest.length);
    if (end < rest.length && end > 0 && (rest.charCodeAt(end) & 0xfc00) === 0xdc00) {
      end += 1;
    }
    return end;
  }
  let consumed = 0;
  for (const part of graphemeSegmenter.segment(rest)) {
    if (consumed >= wanted) {
      break;
    }
    consumed += part.segment.length;
  }
  return Math.min(consumed, rest.length);
}

interface PacedStreamState {
  display: string;
  target: string;
  streaming: boolean;
  rate: number;
  samples: ArrivalSample[];
  carry: number;
  lastTickAt: number;
  frame: number | null;
}

export interface PacedStreamOptions {
  /** Reads the cost of the most recent document build, in ms. */
  workMsRef?: { readonly current: number } | undefined;
}

/**
 * Reveals `text` progressively while `streaming`, and snaps to it once the
 * stream settles or the text stops being an append of what is displayed.
 */
export function usePacedStreamText(
  text: string,
  streaming: boolean,
  options: PacedStreamOptions = {},
): string {
  const [displayText, setDisplayText] = useState(text);
  const workMsRef = options.workMsRef;
  const stateRef = useRef<PacedStreamState>({
    display: text,
    target: text,
    streaming,
    rate: 0,
    samples: [],
    carry: 0,
    lastTickAt: 0,
    frame: null,
  });

  useEffect(() => {
    const state = stateRef.current;
    const now = typeof performance === "undefined" ? Date.now() : performance.now();

    if (text.startsWith(state.target) && text.length > state.target.length) {
      state.samples.push({ at: now, chars: text.length });
      const cutoff = now - RATE_WINDOW_MS;
      while (state.samples.length > 2 && state.samples[0]!.at < cutoff) {
        state.samples.shift();
      }
      const measured = estimateArrivalRate(state.samples);
      if (measured !== null) {
        state.rate = updateArrivalRate(state.rate, measured);
      }
    } else if (!text.startsWith(state.target)) {
      // Replacements are not a rate signal and cannot be paced.
      state.samples = [];
      state.rate = 0;
    }

    state.target = text;
    state.streaming = streaming;

    const appendOnly = text.startsWith(state.display);
    if (!streaming || !appendOnly || !state.display) {
      state.carry = 0;
      if (state.display !== text) {
        state.display = text;
        setDisplayText(text);
      }
      if (!streaming) {
        return;
      }
    }
    ensureLoop(state, setDisplayText, workMsRef, now);
  }, [text, streaming, workMsRef]);

  useEffect(
    () => () => {
      const state = stateRef.current;
      if (state.frame !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(state.frame);
        state.frame = null;
      }
    },
    [],
  );

  return displayText;
}

function ensureLoop(
  state: PacedStreamState,
  setDisplayText: (value: string) => void,
  workMsRef: PacedStreamOptions["workMsRef"],
  now: number,
): void {
  if (typeof requestAnimationFrame !== "function" || typeof performance === "undefined") {
    return;
  }
  if (state.frame !== null) {
    return;
  }
  // The first frame of a burst appears immediately; pacing starts from there.
  if (state.lastTickAt === 0) {
    state.lastTickAt = now;
  }
  state.frame = requestAnimationFrame(() => {
    state.frame = null;
    tick(state, setDisplayText, workMsRef);
  });
}

function tick(
  state: PacedStreamState,
  setDisplayText: (value: string) => void,
  workMsRef: PacedStreamOptions["workMsRef"],
): void {
  const now = performance.now();
  const elapsedMs = now - state.lastTickAt;
  if (elapsedMs < resolveStreamTickMs(workMsRef?.current ?? 0)) {
    ensureLoop(state, setDisplayText, workMsRef, now);
    return;
  }
  state.lastTickAt = now;

  if (!state.streaming) {
    return;
  }
  if (state.display === state.target) {
    return;
  }
  if (!state.target.startsWith(state.display)) {
    state.display = state.target;
    state.carry = 0;
    setDisplayText(state.target);
    return;
  }

  const pending = state.target.length - state.display.length;
  const step = resolveStreamReveal({
    pending,
    rate: state.rate,
    dtMs: elapsedMs,
    carry: state.carry,
  });
  state.carry = step.carry;
  if (step.take <= 0) {
    ensureLoop(state, setDisplayText, workMsRef, now);
    return;
  }
  const advanced = takeStreamUnits(state.target, state.display.length, step.take);
  if (advanced <= 0) {
    ensureLoop(state, setDisplayText, workMsRef, now);
    return;
  }
  state.display = state.target.slice(0, state.display.length + advanced);
  setDisplayText(state.display);
  ensureLoop(state, setDisplayText, workMsRef, now);
}
