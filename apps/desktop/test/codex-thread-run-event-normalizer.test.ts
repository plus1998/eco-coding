import { expect, test } from "bun:test";
import { normalizeCodexThreadRunEventForProjection } from "../src/main/codex-thread-run-event-normalizer";
import type { ThreadRunEventInput } from "../src/shared/thread-run-events";

function codexEvent(eventType: ThreadRunEventInput["eventType"], message: string): ThreadRunEventInput {
  return {
    id: `event-${eventType}`,
    threadId: "thr_codex",
    eventType,
    scope: "main",
    streamState: "none",
    message,
    observedAt: "2026-07-15T00:00:00.000Z",
    metadata: { codexMethod: "turn/started", turnId: "turn_1" },
  };
}

test("normalizes Codex turn lifecycle into request lifecycle", () => {
  expect(
    normalizeCodexThreadRunEventForProjection(codexEvent("run.attempt.started", "Turn started")),
  ).toMatchObject({
    eventType: "request.started",
    requestId: "turn_1",
    message: "Requesting model…",
  });

  expect(
    normalizeCodexThreadRunEventForProjection(codexEvent("run.attempt.completed", "Turn completed")),
  ).toMatchObject({
    eventType: "request.completed",
    requestId: "turn_1",
    message: "Request completed",
  });
});

test("links Codex content and failures to the same request", () => {
  expect(normalizeCodexThreadRunEventForProjection(codexEvent("message.delta", "正在处理"))).toMatchObject({
    eventType: "message.delta",
    requestId: "turn_1",
    message: "正在处理",
  });

  expect(
    normalizeCodexThreadRunEventForProjection(codexEvent("run.attempt.failed", "provider failed")),
  ).toMatchObject({
    eventType: "request.failed",
    requestId: "turn_1",
    message: "provider failed",
  });
});
