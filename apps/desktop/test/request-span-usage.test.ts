import { expect, test } from "bun:test";
import {
  attachOutputTokensToRequestSpans,
  dedupeUsageLedgerRowsForSpanJoin,
  visibleOutputTokensForRate,
} from "../src/shared/request-span-usage";

test("visibleOutputTokensForRate subtracts reasoning from completion total", () => {
  expect(visibleOutputTokensForRate({ outputTokens: 550, reasoningTokens: 129 })).toBe(421);
  expect(visibleOutputTokensForRate({ outputTokens: 100 })).toBe(100);
  expect(visibleOutputTokensForRate({ outputTokens: 0 })).toBeUndefined();
});

test("attachOutputTokensToRequestSpans collapses partial+final rows per invocation", () => {
  const spans = [{ requestId: "r1", status: "completed" as const, startedAt: "2025-01-01T00:00:00.000Z" }];
  const attached = attachOutputTokensToRequestSpans(spans, [
    { outputTokens: 40, reasoningTokens: 10, requestKey: "r1" },
    { outputTokens: 50, reasoningTokens: 5, requestKey: "r1" },
  ]);
  expect(attached[0]).toMatchObject({ outputTokens: 50, reasoningTokens: 10 });
});

test("attachOutputTokensToRequestSpans sums distinct provider invocations in a turn", () => {
  const spans = [
    {
      requestId: "logical-1",
      status: "completed" as const,
      startedAt: "2025-01-01T00:00:00.000Z",
    },
  ];
  const attached = attachOutputTokensToRequestSpans(spans, [
    {
      outputTokens: 100,
      reasoningTokens: 40,
      providerRequestId: "prov-a",
      logicalRequestId: "logical-1",
      generationMs: 2_000,
      source: "codex",
    },
    {
      outputTokens: 80,
      reasoningTokens: 30,
      providerRequestId: "prov-b",
      logicalRequestId: "logical-1",
      generationMs: 3_000,
      source: "codex",
    },
    {
      outputTokens: 50,
      reasoningTokens: 10,
      providerRequestId: "prov-a",
      logicalRequestId: "logical-1",
      generationMs: 2_100,
      source: "codex",
    },
  ]);
  expect(attached[0]).toMatchObject({
    outputTokens: 180,
    reasoningTokens: 70,
    generationMs: 5_100,
  });
});

test("dedupeUsageLedgerRowsForSpanJoin drops pi rows when proxy already billed the logical request", () => {
  const deduped = dedupeUsageLedgerRowsForSpanJoin([
    {
      outputTokens: 120,
      logicalRequestId: "req_a",
      generationMs: 2_000,
      source: "proxy",
      providerRequestId: "msg_a",
    },
    {
      outputTokens: 120,
      logicalRequestId: "req_a",
      source: "pi",
    },
  ]);
  expect(deduped).toHaveLength(1);
  expect(deduped[0]?.source).toBe("proxy");
});

test("attachOutputTokensToRequestSpans avoids double-counting pi and proxy for one PI invocation", () => {
  const spans = [
    {
      requestId: "req_a",
      status: "completed" as const,
      startedAt: "2025-01-01T00:00:00.000Z",
    },
  ];
  const attached = attachOutputTokensToRequestSpans(spans, [
    {
      outputTokens: 500,
      reasoningTokens: 0,
      logicalRequestId: "req_a",
      generationMs: 4_000,
      source: "proxy",
      providerRequestId: "msg_a",
    },
    {
      outputTokens: 500,
      logicalRequestId: "req_a",
      source: "pi",
    },
  ]);
  expect(attached[0]).toMatchObject({
    outputTokens: 500,
    generationMs: 4_000,
  });
});
