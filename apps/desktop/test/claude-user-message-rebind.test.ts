import { expect, test } from "bun:test";
import {
  type ClaudePromptSessionLine,
  planClaudeUserMessageRebindMappings,
  resolveClaudeCurrentSessionUserMessageId,
} from "../src/main/claude-user-message-rebind";
import type { ThreadUserMessageRecord } from "../src/main/conversation-store";

function prompt(activityLineId: string, text: string, upstreamMessageId?: string): ThreadUserMessageRecord {
  return {
    threadId: "thr_1",
    activityLineId,
    ...(upstreamMessageId && { upstreamMessageId }),
    text,
    attachments: [],
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
  };
}

function sessionLine(
  upstreamMessageId: string,
  text: string,
  activityLineId = `sdk:${upstreamMessageId}`,
): ClaudePromptSessionLine {
  return { activityLineId, text, upstreamMessageId };
}

test("fork UUID resolution verifies the complete prompt sequence without changing origin bindings", () => {
  const records = [prompt("user:a", "same", "origin_a"), prompt("user:b", "same", "origin_b")];
  const lines = [sessionLine("fork_a", "same"), sessionLine("fork_b", "same")];
  expect(resolveClaudeCurrentSessionUserMessageId(records, lines, "user:b")).toBe("fork_b");
  expect(records[1]?.upstreamMessageId).toBe("origin_b");
  expect(() => resolveClaudeCurrentSessionUserMessageId(records, [lines[0]!], "user:b")).toThrow("不一致");
  expect(() =>
    resolveClaudeCurrentSessionUserMessageId(
      records,
      [lines[0]!, sessionLine("fork_b", "different")],
      "user:b",
    ),
  ).toThrow("不一致");
});

test("a retained SDK UUID is usable after compaction only when its prompt agrees", () => {
  const records = [prompt("user:a", "first", "origin_a"), prompt("user:b", "second", "origin_b")];
  expect(
    resolveClaudeCurrentSessionUserMessageId(records, [sessionLine("origin_b", "second")], "user:b"),
  ).toBe("origin_b");
  expect(() =>
    resolveClaudeCurrentSessionUserMessageId(records, [sessionLine("origin_b", "tool result")], "user:b"),
  ).toThrow("不一致");
});

test("planClaudeUserMessageRebindMappings binds unbound prompts positionally", () => {
  const plan = planClaudeUserMessageRebindMappings(
    [prompt("user:a", "first"), prompt("user:b", "second")],
    [sessionLine("sdk_a", "first"), sessionLine("sdk_b", "second")],
  );

  expect(plan.mappings).toEqual([
    { activityLineId: "user:a", upstreamMessageId: "sdk_a" },
    { activityLineId: "user:b", upstreamMessageId: "sdk_b" },
  ]);
  expect(plan.rejected).toEqual([]);
});

test("planClaudeUserMessageRebindMappings never re-points an already bound prompt", () => {
  // Production regression: auto-compaction put its summary at the head of the
  // session's user lines, so positional pairing offered the summary's id as the
  // *first* prompt's new history target. The append fails closed on that change
  // and blocks the conversation for good.
  const plan = planClaudeUserMessageRebindMappings(
    [
      prompt("user:c3a73dc6", "first prompt", "c3a73dc6"),
      prompt("user:29ab8f7b", "second prompt", "29ab8f7b"),
      prompt("user:b06589fe", "?", "b06589fe"),
    ],
    [
      sessionLine("efa57c6c", "This session is being continued from a previous conversation"),
      sessionLine("29ab8f7b", "second prompt"),
      sessionLine("b06589fe", "?"),
    ],
  );

  expect(plan.rejected).toEqual([
    {
      activityLineId: "user:c3a73dc6",
      upstreamMessageId: "efa57c6c",
      existing: { activityLineId: "user:c3a73dc6", upstreamMessageId: "c3a73dc6" },
    },
  ]);
  expect(plan.mappings).toEqual([
    { activityLineId: "user:29ab8f7b", upstreamMessageId: "29ab8f7b" },
    { activityLineId: "user:b06589fe", upstreamMessageId: "b06589fe" },
  ]);
});

test("planClaudeUserMessageRebindMappings never moves a provider id to another prompt", () => {
  const plan = planClaudeUserMessageRebindMappings(
    [prompt("user:a", "first"), prompt("user:b", "second", "sdk_b")],
    [sessionLine("sdk_b", "first")],
  );

  expect(plan.rejected).toEqual([
    {
      activityLineId: "user:a",
      upstreamMessageId: "sdk_b",
      existing: { activityLineId: "user:b", upstreamMessageId: "sdk_b" },
    },
  ]);
  expect(plan.mappings).toEqual([]);
});

test("planClaudeUserMessageRebindMappings falls back to text matching when counts differ", () => {
  const plan = planClaudeUserMessageRebindMappings(
    [prompt("user:a", "first"), prompt("user:b", "second")],
    [sessionLine("sdk_b", "second")],
  );

  expect(plan.mappings).toEqual([{ activityLineId: "user:b", upstreamMessageId: "sdk_b" }]);
  expect(plan.rejected).toEqual([]);
});

test("planClaudeUserMessageRebindMappings keeps a session line without a provider id in place", () => {
  const plan = planClaudeUserMessageRebindMappings(
    [prompt("user:a", "first"), prompt("user:b", "second")],
    [sessionLine("", "first"), sessionLine("sdk_b", "second")],
  );

  expect(plan.mappings).toEqual([{ activityLineId: "user:b", upstreamMessageId: "sdk_b" }]);
});
