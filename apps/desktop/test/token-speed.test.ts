import { expect, test } from "bun:test";
import {
  attachOutputTokensToRequestSpans,
  formatTokenSpeedRate,
  formatTokenSpeedSeconds,
  formatTokenSpeedStats,
  isTokenSpeedEligibleSpan,
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

test("thinking-labeled spans remain eligible when badge binds via narrative item", () => {
  expect(
    isTokenSpeedEligibleSpan({ requestId: "r", role: "thinking", status: "completed", startedAt: isoAt(0) }),
  ).toBe(true);
});

test("generationMs on span drives Cherry-style aggregate model TPS", () => {
  const span = {
    requestId: "r",
    status: "completed" as const,
    startedAt: isoAt(0),
    firstTokenAt: isoAt(1_000),
    lastTokenAt: isoAt(1_080),
    streamingEndedAt: isoAt(10_000),
    endedAt: isoAt(10_000),
    outputTokens: 546,
    reasoningTokens: 276,
    generationMs: 12_000,
  };
  const stats = formatTokenSpeedStats(span, "Hello", T0 + 999_999);
  expect(stats.tokenSource).toBe("usage");
  expect(stats.rateTps).toBeCloseTo(270 / 12, 5);
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

test("completed span keeps decode rate at stream finalize when request.completed arrives later", () => {
  const span = {
    requestId: "r",
    status: "completed" as const,
    startedAt: isoAt(0),
    firstTokenAt: isoAt(1_000),
    streamingEndedAt: isoAt(4_000),
    endedAt: isoAt(4_000),
    outputTokens: 100,
    decodeActiveMs: 3_000,
  };
  const text = "x".repeat(400);
  const stats = formatTokenSpeedStats(span, text, T0 + 999_999);
  expect(stats.rateTps).toBeCloseTo(100 / 3, 5);
});

test("provider usage tokens prefer Cherry-style rate when usage matches visible text", () => {
  const span = {
    requestId: "r",
    status: "completed" as const,
    startedAt: isoAt(0),
    firstTokenAt: isoAt(1_000),
    lastTokenAt: isoAt(5_000),
    decodeActiveMs: 4_000,
    endedAt: isoAt(5_000),
    outputTokens: 100,
  };
  const text = "x".repeat(400);
  const stats = formatTokenSpeedStats(span, text, T0 + 999_999);
  expect(stats.tokenSource).toBe("usage");
  expect(stats.streamedTokens).toBe(100);
  expect(stats.rateTps).toBeCloseTo(25, 5);
});

test("withholds unreliable decode rate when turn-aggregated usage meets short thinking window", () => {
  const span = {
    requestId: "r",
    status: "completed" as const,
    startedAt: isoAt(0),
    firstTokenAt: isoAt(85_000),
    lastTokenAt: isoAt(85_057),
    streamingEndedAt: isoAt(85_057),
    endedAt: isoAt(85_057),
    outputTokens: 1094,
    reasoningTokens: 646,
  };
  const stats = formatTokenSpeedStats(span, "x".repeat(100), T0 + 999_999);
  expect(stats.ttftMs).toBe(85_000);
  expect(stats.rateTps).toBeUndefined();
});

test("withholds tok/s when decode window is too short to measure", () => {
  const span = {
    requestId: "r",
    status: "completed" as const,
    startedAt: isoAt(0),
    firstTokenAt: isoAt(1_000),
    lastTokenAt: isoAt(1_040),
    streamingEndedAt: isoAt(1_040),
    endedAt: isoAt(2_000),
    outputTokens: 500,
  };
  const stats = formatTokenSpeedStats(span, "x".repeat(2000), T0 + 999_999);
  expect(stats.ttftMs).toBe(1_000);
  expect(stats.rateTps).toBeUndefined();
});

test("generationMs path uses provider completion tokens for tool-call invocations", () => {
  const span = {
    requestId: "r",
    status: "completed" as const,
    startedAt: isoAt(0),
    firstTokenAt: isoAt(500),
    lastTokenAt: isoAt(2_500),
    streamingEndedAt: isoAt(2_500),
    endedAt: isoAt(2_500),
    outputTokens: 480,
    generationMs: 2_000,
  };
  const visible = "Sure, I'll read that file for you.";
  const stats = formatTokenSpeedStats(span, visible, T0 + 999_999);
  expect(stats.tokenSource).toBe("usage");
  expect(stats.rateTps).toBeCloseTo(240, 0);
});

test("reasoning_tokens on span drives visible tok/s without text-estimate fallback", () => {
  const span = {
    requestId: "r",
    status: "completed" as const,
    startedAt: isoAt(0),
    firstTokenAt: isoAt(9_000),
    lastTokenAt: isoAt(10_000),
    streamingEndedAt: isoAt(10_000),
    endedAt: isoAt(11_000),
    outputTokens: 500,
    reasoningTokens: 497,
  };
  const visible = "Hello world"; // ~3 estimated tokens
  const stats = formatTokenSpeedStats(span, visible, T0 + 999_999);
  expect(stats.streamedTokens).toBe(500);
  expect(stats.tokenSource).toBe("usage");
  expect(stats.rateTps).toBeCloseTo(3, 1);
});

test("thinking-shortened decode window falls back to visible text tokens when reasoning_tokens missing", () => {
  const span = {
    requestId: "r",
    status: "completed" as const,
    startedAt: isoAt(0),
    firstTokenAt: isoAt(9_000),
    lastTokenAt: isoAt(10_000),
    streamingEndedAt: isoAt(10_000),
    endedAt: isoAt(11_000),
    outputTokens: 500,
  };
  const visible = "Hello world"; // ~3 estimated tokens
  const stats = formatTokenSpeedStats(span, visible, T0 + 999_999);
  // Without fallback: 500 / 2s = 250 tps. With usage>>text guard: ~1.5 tps from estimate.
  expect(stats.tokenSource).toBe("estimate");
  expect(stats.rateTps).toBeCloseTo(3, 1);
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

test("attachOutputTokensToRequestSpans joins reasoning_tokens from ledger", () => {
  const spans = [
    {
      requestId: "req_abc",
      status: "completed" as const,
      startedAt: isoAt(0),
    },
  ];
  const attached = attachOutputTokensToRequestSpans(spans, [
    { outputTokens: 550, reasoningTokens: 129, requestKey: "proxy:planner:model:req_abc:1:2:0:0" },
  ]);
  expect(attached[0]?.outputTokens).toBe(550);
  expect(attached[0]?.reasoningTokens).toBe(129);
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
    { requestId: "t", role: "thinking", status: "completed" as const, startedAt: isoAt(9_500) },
  ];
  // item starts at 9s, role coder -> picks span c (most recent coder startedAt <= 9s)
  expect(resolveLenientRequestSpan({ at: isoAt(9_000), role: "coder" }, spans)?.requestId).toBe("c");
  // item role planner -> picks span a (only planner)
  expect(resolveLenientRequestSpan({ at: isoAt(9_000), role: "planner" }, spans)?.requestId).toBe("a");
  // no role -> most recent overall startedAt <= item.at
  expect(resolveLenientRequestSpan({ at: isoAt(10_000) }, spans)?.requestId).toBe("t");
  // item before any span -> undefined
  expect(resolveLenientRequestSpan({ at: isoAt(-1_000) }, spans)).toBeUndefined();
  // empty spans -> undefined
  expect(resolveLenientRequestSpan({ at: isoAt(9_000) }, [])).toBeUndefined();
});
