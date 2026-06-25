import { expect, test } from "bun:test";
import {
  computeRequestSpanTtftMs,
  computeRequestSpanWaitingMs,
  resolveRequestSpanDurationMs,
} from "../src/shared/request-span-timing";

test("computeRequestSpanWaitingMs uses persisted startedAt while waiting", () => {
  const startedAt = "2026-01-01T00:00:00.000Z";
  const nowMs = Date.parse("2026-01-01T00:00:05.500Z");

  expect(
    computeRequestSpanWaitingMs(
      {
        status: "waiting_first_token",
        startedAt,
      },
      nowMs,
    ),
  ).toBe(5500);
});

test("computeRequestSpanWaitingMs keeps ticking for streaming without first token", () => {
  const startedAt = "2026-01-01T00:00:00.000Z";
  const nowMs = Date.parse("2026-01-01T00:00:12.000Z");

  expect(
    computeRequestSpanWaitingMs(
      {
        status: "streaming",
        startedAt,
      },
      nowMs,
    ),
  ).toBe(12_000);
});

test("computeRequestSpanWaitingMs returns zero once first token is recorded", () => {
  expect(
    computeRequestSpanWaitingMs(
      {
        status: "streaming",
        startedAt: "2026-01-01T00:00:00.000Z",
        firstTokenAt: "2026-01-01T00:00:03.000Z",
      },
      Date.parse("2026-01-01T00:00:10.000Z"),
    ),
  ).toBe(0);
});

test("computeRequestSpanWaitingMs returns zero for completed spans", () => {
  expect(
    computeRequestSpanWaitingMs(
      {
        status: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        firstTokenAt: "2026-01-01T00:00:02.000Z",
      },
      Date.parse("2026-01-01T00:00:10.000Z"),
    ),
  ).toBe(0);
});

test("computeRequestSpanTtftMs derives first-token latency from persisted timestamps", () => {
  expect(
    computeRequestSpanTtftMs({
      status: "streaming",
      startedAt: "2026-01-01T00:00:00.000Z",
      firstTokenAt: "2026-01-01T00:00:04.250Z",
    }),
  ).toBe(4250);
});

test("computeRequestSpanWaitingMs returns zero for invalid startedAt", () => {
  expect(
    computeRequestSpanWaitingMs(
      {
        status: "waiting_first_token",
        startedAt: "not-a-timestamp",
      },
      Date.parse("2026-01-01T00:00:10.000Z"),
    ),
  ).toBe(0);
});

test("computeRequestSpanTtftMs returns undefined without firstTokenAt", () => {
  expect(
    computeRequestSpanTtftMs({
      status: "waiting_first_token",
      startedAt: "2026-01-01T00:00:00.000Z",
    }),
  ).toBeUndefined();
});

test("resolveRequestSpanDurationMs falls back to endedAt when firstTokenAt is missing", () => {
  expect(
    resolveRequestSpanDurationMs({
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:06.500Z",
    }),
  ).toBe(6500);
});

test("computeRequestSpanTtftMs returns undefined for invalid timestamps", () => {
  expect(
    computeRequestSpanTtftMs({
      status: "streaming",
      startedAt: "bad",
      firstTokenAt: "2026-01-01T00:00:01.000Z",
    }),
  ).toBeUndefined();
});
