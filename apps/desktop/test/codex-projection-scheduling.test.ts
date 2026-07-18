import { expect, test } from "bun:test";
import { isCodexStreamingProjectionEvent } from "../src/main/codex-runtime-run";
import type { ThreadRunEventInput } from "../src/shared/thread-run-events";

function event(
  eventType: ThreadRunEventInput["eventType"],
  streamState: ThreadRunEventInput["streamState"],
): ThreadRunEventInput {
  return {
    id: `event-${eventType}`,
    threadId: "thread-1",
    eventType,
    scope: "main",
    streamState,
    message: "",
  };
}

test("Codex tool lifecycle projections publish immediately", () => {
  expect(isCodexStreamingProjectionEvent(event("tool.started", "streaming"))).toBe(false);
  expect(isCodexStreamingProjectionEvent(event("tool.completed", "finalized"))).toBe(false);
  expect(isCodexStreamingProjectionEvent(event("tool.failed", "finalized"))).toBe(false);
});

test("Codex message projections publish immediately", () => {
  expect(isCodexStreamingProjectionEvent(event("message.delta", "streaming"))).toBe(false);
  expect(isCodexStreamingProjectionEvent(event("message.final", "finalized"))).toBe(false);
});

test("Codex thinking deltas keep the streaming projection cadence", () => {
  expect(isCodexStreamingProjectionEvent(event("thinking.delta", "streaming"))).toBe(true);
  expect(isCodexStreamingProjectionEvent(event("thinking.final", "finalized"))).toBe(false);
});
