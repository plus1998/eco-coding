import { expect, test } from "bun:test";
import {
  attachOutputTokensToRequestSpans,
  formatTokenSpeedRate,
  formatTokenSpeedSeconds,
  formatTokenSpeedStats,
  isTokenSpeedSpanActive,
  resolveLenientRequestSpan,
} from "../src/renderer/token-speed";
import {
  DEFAULT_TOKEN_SPEED_PREFERENCES,
  normalizeTokenSpeedPreferences,
} from "../src/renderer/token-speed-preferences";

const T0 = Date.parse("2025-01-01T00:00:00.000Z");

function isoAt(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString();
}

test("token speed preference defaults to disabled", () => {
  expect(DEFAULT_TOKEN_SPEED_PREFERENCES.showTokenSpeed).toBe(false);
  expect(normalizeTokenSpeedPreferences(undefined)).toEqual({ showTokenSpeed: false });
  expect(normalizeTokenSpeedPreferences(null)).toEqual({ showTokenSpeed: false });
  expect(normalizeTokenSpeedPreferences({ showTokenSpeed: "yes" })).toEqual({
    showTokenSpeed: false,
  });
  expect(normalizeTokenSpeedPreferences({ showTokenSpeed: true })).toEqual({
    showTokenSpeed: true,
  });
});

test("span active detection only covers open request states", () => {
  expect(isTokenSpeedSpanActive({ requestId: "r", status: "waiting_first_token", startedAt: isoAt(0) })).toBe(
    true,
  );
  expect(isTokenSpeedSpanActive({ requestId: "r", status: "streaming", startedAt: isoAt(0) })).toBe(true);
  expect(isTokenSpeedSpanActive({ requestId: "r", status: "completed", startedAt: isoAt(0) })).toBe(false);
});

test("waiting span reports elapsed wait and no ttft/rate", () => {
  const span = { requestId: "r", status: "waiting_first_token" as const, startedAt: isoAt(0) };
  const stats = formatTokenSpeedStats(span, "hello", T0 + 3_200);
  expect(stats.active).toBe(true);
  expect(stats.waitingMs).toBe(3_200);
  expect(stats.ttftMs).toBeUndefined();
  expect(stats.rateTps).toBeUndefined();
  expect(stats.tokenSource).toBe("estimate");
});

test("streaming span reports ttft but withholds live decode rate", () => {
  const span = {
    requestId: "r",
    status: "streaming" as const,
    startedAt: isoAt(0),
    firstTokenAt: isoAt(1_200),
  };
  const text = "aaaa bbbb cccc"; // 14 ascii chars -> 4 estimated tokens
  const stats = formatTokenSpeedStats(span, text, T0 + 5_200);
  expect(stats.active).toBe(true);
  expect(stats.waitingMs).toBeUndefined();
  expect(stats.ttftMs).toBe(1_200);
  expect(stats.streamedTokens).toBe(4);
  expect(stats.tokenSource).toBe("estimate");
  // Live rate omitted — partial windows + text estimates spike wildly.
  expect(stats.rateTps).toBeUndefined();
});

test("completed span without first token stays inactive with no timing", () => {
  const span = { requestId: "r", status: "completed" as const, startedAt: isoAt(0) };
  const stats = formatTokenSpeedStats(span, "hi", T0 + 500);
  expect(stats.active).toBe(false);
  expect(stats.waitingMs).toBeUndefined();
  expect(stats.ttftMs).toBeUndefined();
  expect(stats.tokenSource).toBe("estimate");
});

test("completed span keeps final ttft and rate measured over the full decode window", () => {
  const span = {
    requestId: "r",
    status: "completed" as const,
    startedAt: isoAt(0),
    firstTokenAt: isoAt(1_200),
    endedAt: isoAt(4_200),
  };
  const text = "aaaa bbbb cccc"; // 14 ascii chars -> 4 estimated tokens
  const stats = formatTokenSpeedStats(span, text, T0 + 999_999);
  expect(stats.active).toBe(false);
  expect(stats.ttftMs).toBe(1_200);
  expect(stats.tokenSource).toBe("estimate");
  // 4 tokens over (4_200 - 1_200) ms = 4/3 tps, independent of `now`
  expect(stats.rateTps).toBeCloseTo(4 / 3, 5);
});

test("provider usage tokens prefer Cherry-style rate over text estimates", () => {
  const span = {
    requestId: "r",
    status: "completed" as const,
    startedAt: isoAt(0),
    firstTokenAt: isoAt(1_000),
    endedAt: isoAt(5_000),
    outputTokens: 100,
  };
  // Text would estimate far fewer tokens; usage wins.
  const stats = formatTokenSpeedStats(span, "hi", T0 + 999_999);
  expect(stats.tokenSource).toBe("usage");
  expect(stats.streamedTokens).toBe(100);
  // Cherry: 100 / ((5000-1000)/1000) = 25 tps
  expect(stats.rateTps).toBeCloseTo(25, 5);
});

test("attachOutputTokensToRequestSpans joins by providerRequestId and proxy requestKey", () => {
  const spans = [
    {
      requestId: "logical-1",
      status: "completed" as const,
      startedAt: isoAt(0),
      providerRequestId: "prov-9",
    },
    {
      requestId: "req_abc",
      status: "completed" as const,
      startedAt: isoAt(1_000),
    },
  ];
  const attached = attachOutputTokensToRequestSpans(spans, [
    { outputTokens: 40, providerRequestId: "prov-9" },
    { outputTokens: 12, requestKey: "proxy:planner:model:req_abc:1:2:0:0" },
    { outputTokens: 99, providerRequestId: "unrelated" },
  ]);
  expect(attached[0]?.outputTokens).toBe(40);
  expect(attached[1]?.outputTokens).toBe(12);
});

test("formatters round to sensible precision", () => {
  expect(formatTokenSpeedSeconds(3_240)).toBe("3.2");
  expect(formatTokenSpeedSeconds(12_400)).toBe("12");
  expect(formatTokenSpeedRate(45.6)).toBe("45.6");
  expect(formatTokenSpeedRate(123.4)).toBe("123");
});

test("lenient span resolution prefers the most recent span before the item, matching role first", () => {
  const spans = [
    { requestId: "a", role: "planner", status: "completed" as const, startedAt: isoAt(0) },
    { requestId: "b", role: "coder", status: "completed" as const, startedAt: isoAt(2_000) },
    { requestId: "c", role: "coder", status: "completed" as const, startedAt: isoAt(8_000) },
  ];
  // item starts at 9s, role coder -> picks span c (most recent coder startedAt <= 9s)
  expect(resolveLenientRequestSpan({ at: isoAt(9_000), role: "coder" }, spans)?.requestId).toBe("c");
  // item role planner -> picks span a (only planner)
  expect(resolveLenientRequestSpan({ at: isoAt(9_000), role: "planner" }, spans)?.requestId).toBe("a");
  // no role -> most recent overall startedAt <= item.at
  expect(resolveLenientRequestSpan({ at: isoAt(9_000) }, spans)?.requestId).toBe("c");
  // item before any span -> undefined
  expect(resolveLenientRequestSpan({ at: isoAt(-1_000) }, spans)).toBeUndefined();
  // empty spans -> undefined
  expect(resolveLenientRequestSpan({ at: isoAt(9_000) }, [])).toBeUndefined();
});
