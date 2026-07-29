import { expect, test } from "bun:test";
import { shouldAdvanceThreadRunEventSequence } from "../src/main/thread-run-event-sequence";

test("cumulative stream updates advance the incremental synchronization sequence", () => {
  expect(
    shouldAdvanceThreadRunEventSequence({
      id: "tre:stream:thr_1:req_1:message.delta:text:0",
      eventType: "message.delta",
    }),
  ).toBe(true);
  expect(
    shouldAdvanceThreadRunEventSequence({
      id: "tre:stream:thr_1:req_1:thinking.delta:thinking:0",
      eventType: "thinking.delta",
    }),
  ).toBe(true);
  expect(
    shouldAdvanceThreadRunEventSequence({
      id: "tre:codex:message.delta:codex-thread:turn:item",
      eventType: "message.delta",
    }),
  ).toBe(true);
});

test("immutable and metadata-only events keep their timeline ordering sequence", () => {
  expect(
    shouldAdvanceThreadRunEventSequence({
      id: "tre:final_1",
      eventType: "message.final",
    }),
  ).toBe(false);
  expect(
    shouldAdvanceThreadRunEventSequence({
      id: "tre:tool_1",
      eventType: "tool.started",
    }),
  ).toBe(false);
});
