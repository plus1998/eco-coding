import { expect, test } from "bun:test";
import {
  estimateArrivalRate,
  resolveStreamReveal,
  resolveStreamTickMs,
  splitStreamingTextUnits,
  STREAM_MAX_INSTANT_RATE,
  STREAM_CATCH_UP_MS,
  STREAM_MAX_STEP_FRAMES,
  STREAM_REVEAL_TARGET_LAG_MS,
  STREAM_TICK_MAX_MS,
  STREAM_TICK_MIN_MS,
  takeStreamUnits,
  updateArrivalRate,
  type ArrivalSample,
} from "../src/renderer/use-paced-stream-text";

test("takeStreamUnits never splits a grapheme or surrogate pair", () => {
  // Combining marks and skin-tone sequences must stay whole: revealing half of
  // them would flash a broken glyph for a frame.
  const text = "你👍🏽e\u0301好";
  expect(takeStreamUnits(text, 0, 1)).toBe(1);
  expect(takeStreamUnits(text, 1, 1)).toBe(4);
  expect(takeStreamUnits(text, 5, 1)).toBe(2);
  expect(takeStreamUnits(text, 7, 1)).toBe(1);
  expect(takeStreamUnits(text, 8, 9)).toBe(0);
  expect(takeStreamUnits(text, 0, 0)).toBe(0);

  // A reveal floor must not split a surrogate pair either.
  const ascii = "a👍🏽b";
  expect(takeStreamUnits(ascii, 0, 1)).toBe(1);
  expect(takeStreamUnits(ascii, 1, 1)).toBe(4);
  expect(takeStreamUnits(ascii, 5, 1)).toBe(1);
  expect(takeStreamUnits(ascii, ascii.length, 5)).toBe(0);
});

test("a slow stream advances by at most one unit per frame and keeps a small lag", () => {
  const rate = 40;
  let carry = 0;
  let displayed = 0;
  let arrived = 0;
  const steps: number[] = [];
  const lags: number[] = [];
  for (let tick = 0; tick < 600; tick += 1) {
    arrived += rate * 0.016;
    const pending = Math.floor(arrived) - displayed;
    const step = resolveStreamReveal({ pending, rate, dtMs: 16, carry });
    carry = step.carry;
    steps.push(step.take);
    displayed += step.take;
    lags.push(((Math.floor(arrived) - displayed) / rate) * 1000);
  }
  // The old threshold pacer produced 4/4/4/4/16 bursts here: a visible freeze.
  expect(Math.max(...steps)).toBeLessThanOrEqual(2);
  const median = [...steps].sort((a, b) => a - b)[Math.floor(steps.length / 2)]!;
  expect(median).toBe(1);
  expect(Math.max(...lags.slice(100))).toBeLessThanOrEqual(STREAM_REVEAL_TARGET_LAG_MS);
});

test("the reveal tracks the arrival rate instead of a fixed backlog", () => {
  for (const rate of [200, 1000]) {
    const dtMs = 16;
    let carry = 0;
    let displayed = 0;
    let arrived = 0;
    const steps: number[] = [];
    for (let tick = 0; tick < 400; tick += 1) {
      arrived += (rate * dtMs) / 1000;
      const pending = Math.floor(arrived) - displayed;
      const step = resolveStreamReveal({ pending, rate, dtMs, carry });
      carry = step.carry;
      steps.push(step.take);
      displayed += step.take;
    }
    const settled = steps.slice(50);
    const expected = (rate * dtMs) / 1000;
    const median = [...settled].sort((a, b) => a - b)[Math.floor(settled.length / 2)]!;
    expect(Math.abs(median - expected)).toBeLessThanOrEqual(1);
    // Even pacing: no tick may reveal twice the steady-state step.
    expect(Math.max(...settled)).toBeLessThanOrEqual(Math.ceil(expected) + 1);
  }
});

test("an arrival burst drains smoothly instead of snapping", () => {
  const rate = 40;
  let carry = 0;
  let displayed = 0;
  let arrived = 0;
  const steps: number[] = [];
  const lags: number[] = [];
  for (let tick = 0; tick < 200; tick += 1) {
    // 300 characters arrive at once at tick 20; the stream continues at 40/s.
    if (tick === 20) arrived += 300;
    arrived += rate * 0.016;
    const pending = Math.floor(arrived) - displayed;
    const step = resolveStreamReveal({ pending, rate, dtMs: 16, carry });
    carry = step.carry;
    steps.push(step.take);
    displayed += step.take;
    lags.push(((Math.floor(arrived) - displayed) / rate) * 1000);
  }
  // A 300 character arrival becomes a fast but continuous flow, never a lump.
  expect(Math.max(...steps)).toBeLessThan(12);
  // The speed decelerates: the lag only ever shrinks after the burst (within
  // the one-character jitter of an integer reveal step).
  const afterBurst = lags.slice(22);
  const oneCharMs = (1 / rate) * 1000;
  for (let index = 1; index < afterBurst.length; index += 1) {
    expect(afterBurst[index]!).toBeLessThanOrEqual(afterBurst[index - 1]! + oneCharMs * 2);
  }
  // And the backlog converges back to the target lag instead of sitting behind
  // (the proportional catch-up decays asymptotically, so allow some slack).
  expect(afterBurst[afterBurst.length - 1]!).toBeLessThan(STREAM_REVEAL_TARGET_LAG_MS * 1.6);
});

test("a large clump never lands in a single tick", () => {
  const rate = 40;
  const dtMs = 16;
  const steady = (rate * dtMs) / 1000;
  const step = resolveStreamReveal({ pending: 5_000, rate, dtMs, carry: 0 });
  expect(step.take).toBeLessThanOrEqual(Math.ceil(steady * STREAM_MAX_STEP_FRAMES));
  expect(step.take).toBeGreaterThan(1);
  expect(step.carry).toBeLessThan(1);
});

test("resolveStreamTickMs only slows down when a build costs real time", () => {
  expect(resolveStreamTickMs(0)).toBe(STREAM_TICK_MIN_MS);
  expect(resolveStreamTickMs(0.4)).toBe(STREAM_TICK_MIN_MS);
  expect(resolveStreamTickMs(5)).toBeGreaterThan(STREAM_TICK_MIN_MS);
  expect(resolveStreamTickMs(50)).toBe(STREAM_TICK_MAX_MS);
  expect(resolveStreamTickMs(Number.NaN)).toBe(STREAM_TICK_MIN_MS);
});

test("arrival rate estimation uses the recent window and clamps bursts", () => {
  const samples: ArrivalSample[] = [
    { at: 0, chars: 0 },
    { at: 500, chars: 250 },
  ];
  expect(estimateArrivalRate(samples)).toBeCloseTo(500, 5);
  expect(estimateArrivalRate([{ at: 0, chars: 0 }])).toBeNull();
  expect(estimateArrivalRate([])).toBeNull();

  // One sample cannot jump the rate to an absurd value.
  expect(updateArrivalRate(0, 50_000)).toBe(STREAM_MAX_INSTANT_RATE);
  expect(updateArrivalRate(100, 0)).toBeCloseTo(70, 5);
});
