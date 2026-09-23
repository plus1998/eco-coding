import { expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import type {
  ConversationAgent,
  ConversationMessage,
  ConversationRun,
  ConversationToolCall,
} from "@eco/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { appendLegacyThreadRunEventToConversationV2 } from "../src/main/conversation-v2-legacy-adapter";
import { ConversationV2Store } from "../src/main/conversation-v2-store";
import {
  ActivityLogView,
  buildConversationV2OnlyProjection,
  mergeConversationV2IntoProjection,
  mergeConversationV2MessagesIntoProjection,
} from "../src/renderer/ActivityLogView";
import type { ConversationV2RendererState } from "../src/renderer/conversation-v2-renderer-state";
import type { ThreadRunProjectionMainFeedEntry } from "../src/renderer/conversation-v2-projection-view";
import { buildThreadRunProjectionViewModel } from "../src/renderer/conversation-v2-projection-view";
import { buildThreadRunTurnFeedSections } from "../src/renderer/conversation-v2-turn-feed";
import type { ThreadRunProjectionSnapshot, ThreadRunProjectionTimelineItem } from "../src/shared/ipc";

function message(messageId: string, createdSeq: number): ConversationMessage {
  return {
    messageId,
    conversationId: "thread_merge",
    turnId: `turn_${createdSeq}`,
    role: "user",
    channel: "answer",
    createdSeq,
    versionSeq: createdSeq,
    contentVersion: 0,
    body: "same prompt",
    status: "final",
    isDeleted: false,
  };
}

function legacyUserItem(id: string, sequence: number): ThreadRunProjectionTimelineItem {
  return {
    id,
    sequence,
    eventType: "thread.status",
    scope: "main",
    role: "user",
    text: "same prompt",
    at: `2026-09-14T00:00:0${sequence}.000Z`,
    metadata: { liveType: "thread.user_prompt" },
  };
}

function legacyAssistantItem(
  id: string,
  sequence: number,
  runAttemptId = "run_1",
): ThreadRunProjectionTimelineItem {
  return {
    id,
    sequence,
    eventType: "message.final",
    scope: "agent",
    role: "assistant",
    text: id,
    at: `2026-09-14T00:00:0${sequence}.000Z`,
    runAttemptId,
    metadata: {},
  };
}

function v2State(
  messages: ConversationMessage[],
  runs: ConversationRun[] = [],
  tools: ConversationToolCall[] = [],
  agents: ConversationAgent[] = [],
): ConversationV2RendererState {
  return {
    conversationId: "thread_merge",
    storeEpoch: "epoch_1",
    appliedSeq: 2,
    historyRevision: 0,
    messages: new Map(messages.map((value) => [value.messageId, value])),
    runs: new Map(runs.map((value) => [value.runId, value])),
    agents: new Map(agents.map((value) => [value.agentId, value])),
    tools: new Map(tools.map((value) => [value.toolCallId, value])),
    details: new Map(),
    effectHashes: new Map(),
    // The renderer state is read through the production paging path in the app; this
    // helper hands the projection one window, which is all these tests need.
    hasOlder: false,
  };
}

function projection(timeline: ThreadRunProjectionTimelineItem[]): ThreadRunProjectionSnapshot {
  return {
    thread: {
      threadId: "thread_merge",
      status: "completed",
      generatedAt: "2026-09-14T00:00:00.000Z",
    },
    attempts: [],
    agents: [],
    requestSpans: [],
    timeline,
    diagnostics: [],
    sourceEventCount: timeline.length,
  };
}

test("keeps two user prompts that say the same thing as two rows", () => {
  // A reader who sends the same short message twice ("继续" again) wrote two prompts; the log
  // holds two V2 messages and both turns have to be in the Feed. The redundancy rule that
  // drops echoed assistant speech must not read a prompt as an answer: in the V2 read model a
  // prompt carries the same event type an answer does.
  const state = v2State([message("message_1", 1), message("message_2", 2)]);
  const viewModel = buildThreadRunProjectionViewModel(
    buildConversationV2OnlyProjection(state, {
      createdAt: "2026-09-14T00:00:00.000Z",
      status: "completed",
    }),
    { id: "thread_merge", prompt: "same prompt" },
  );
  const rows = viewModel.mainFeedEntries.flatMap((entry) =>
    entry.kind === "timeline" && entry.item.role === "user" ? [entry.item.text] : [],
  );
  expect(rows).toEqual(["same prompt", "same prompt"]);
});

test("does not infer V2 user-message identity from equal body text", () => {
  const merged = mergeConversationV2MessagesIntoProjection(
    projection([legacyUserItem("legacy_1", 1), legacyUserItem("legacy_2", 2)]),
    v2State([message("message_1", 1), message("message_2", 2)]),
  );

  expect(merged.timeline.filter((item) => item.id.startsWith("legacy_")).map((item) => item.id)).toEqual([
    "legacy_1",
    "legacy_2",
  ]);
  expect(
    merged.timeline.filter((item) => item.id.startsWith("conversation-v2:")).map((item) => item.id),
  ).toEqual(["conversation-v2:message_1", "conversation-v2:message_2"]);
});

test("uses an explicit V2 message id to remove only its legacy row", () => {
  const first = legacyUserItem("legacy_1", 1);
  first.metadata = { ...first.metadata, conversationV2MessageId: "message_1" };
  const merged = mergeConversationV2MessagesIntoProjection(
    projection([first, legacyUserItem("legacy_2", 2)]),
    v2State([message("message_1", 1), message("message_2", 2)]),
  );

  expect(merged.timeline.map((item) => item.id)).toEqual([
    "conversation-v2:message_1",
    "legacy_2",
    "conversation-v2:message_2",
  ]);
});

test("keeps an explicitly bound user message above a later agent row", () => {
  const user = legacyUserItem("legacy_user", 1);
  user.metadata = { ...user.metadata, conversationV2MessageId: "message_1" };
  const merged = mergeConversationV2MessagesIntoProjection(
    projection([user, legacyAssistantItem("legacy_agent", 2)]),
    v2State([message("message_1", 1)]),
  );

  expect(merged.timeline.map((item) => item.id)).toEqual(["conversation-v2:message_1", "legacy_agent"]);
});

test("places an unanchored user message before a later legacy agent row", () => {
  const merged = mergeConversationV2MessagesIntoProjection(
    projection([legacyAssistantItem("legacy_agent", 2)]),
    v2State([message("message_1", 1)]),
  );

  expect(merged.timeline.map((item) => item.id)).toEqual(["conversation-v2:message_1", "legacy_agent"]);
});

test("does not remove an unmapped message from the same run and channel", () => {
  const mapped = legacyAssistantItem("legacy_mapped", 1);
  mapped.metadata = { conversationV2MessageId: "message_1" };
  const unmapped = legacyAssistantItem("legacy_unmapped", 2);
  const merged = mergeConversationV2MessagesIntoProjection(
    projection([mapped, unmapped]),
    v2State([
      { ...message("message_1", 1), role: "assistant", runId: "run_1" },
      { ...message("message_2", 2), role: "assistant", runId: "run_1" },
    ]),
  );

  expect(merged.timeline.map((item) => item.id)).toEqual([
    "conversation-v2:message_1",
    "legacy_unmapped",
    "conversation-v2:message_2",
  ]);
});

test("renders a V2 message when the legacy projection is unavailable", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      conversationV2: v2State([message("message_1", 1)]),
    }),
  );

  expect(html).toContain("same prompt");
  expect(html).not.toContain("run-log-projection-loading");
});

test("renders V2 running execution and tool state when the legacy projection is empty", () => {
  const run: ConversationRun = {
    runId: "run_live",
    conversationId: "thread_merge",
    turnId: "turn_live",
    status: "running",
    startedAt: "2026-09-14T00:00:01.000Z",
    versionSeq: 2,
    timingQuality: "recorded",
  };
  const tool: ConversationToolCall = {
    toolCallId: "tool_live",
    conversationId: "thread_merge",
    runId: run.runId,
    name: "mcp__eco__inspect",
    status: "running",
    createdSeq: 3,
    versionSeq: 3,
  };

  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      conversationV2: v2State([], [run], [tool]),
    }),
  );

  expect(html).toContain("处理中");
  expect(html).toContain("正在调用 MCP");
  expect(html).toContain("run-log-shimmer-text");
  expect(html).not.toContain("run-log-projection-loading");
  expect(html).not.toContain("正在思考");
});

test("a conflicting terminal V2 run cannot overwrite the attempt that settled it", () => {
  const base = projection([legacyAssistantItem("legacy_final", 1)]);
  base.attempts = [
    {
      attemptId: "run_1",
      phase: "initial",
      retryIndex: 0,
      status: "failed",
      startedAt: "2026-09-16T09:41:36.822Z",
      endedAt: "2026-09-16T09:57:27.208Z",
    },
  ];
  const run: ConversationRun = {
    runId: "run_1",
    conversationId: "thread_merge",
    turnId: "run_1",
    status: "completed",
    startedAt: "2026-09-16T09:41:36.822Z",
    endedAt: "2026-09-16T09:41:47.944Z",
    versionSeq: 2,
    timingQuality: "unknown",
  };

  const merged = mergeConversationV2IntoProjection(base, v2State([], [run]));

  // Only a stale mirror can disagree with the attempt lifecycle on how a run
  // ended, so the attempt keeps its own verdict and duration.
  expect(merged.attempts[0]).toMatchObject({
    attemptId: "run_1",
    status: "failed",
    startedAt: "2026-09-16T09:41:36.822Z",
    endedAt: "2026-09-16T09:57:27.208Z",
  });
});

test("V2 terminal tool state upgrades its legacy row without duplicating it", () => {
  const legacy = legacyAssistantItem("tool_started", 1);
  legacy.eventType = "tool.started";
  legacy.role = "tool";
  legacy.text = "Tool: Read";
  legacy.metadata = {
    tool: {
      name: "Read",
      toolUseId: "tool_1",
      status: "started",
    },
  };
  const run: ConversationRun = {
    runId: "run_1",
    conversationId: "thread_merge",
    turnId: "turn_1",
    status: "completed",
    startedAt: "2026-09-14T00:00:00.000Z",
    endedAt: "2026-09-14T00:00:02.000Z",
    versionSeq: 3,
    timingQuality: "recorded",
  };
  const tool: ConversationToolCall = {
    toolCallId: "tool_1",
    conversationId: "thread_merge",
    runId: run.runId,
    name: "Read",
    status: "completed",
    createdSeq: 1,
    versionSeq: 2,
  };

  const merged = mergeConversationV2IntoProjection(projection([legacy]), v2State([], [run], [tool]));

  expect(merged.timeline).toHaveLength(1);
  expect(merged.timeline[0]?.eventType).toBe("tool.completed");
  expect(merged.timeline[0]?.metadata?.tool).toMatchObject({
    toolUseId: "tool_1",
    status: "completed",
  });
  expect(merged.attempts).toHaveLength(1);
  expect(merged.attempts[0]?.status).toBe("completed");
});

test("V2 tool input keeps the rich desktop presentation metadata", () => {
  const edit: ConversationToolCall = {
    toolCallId: "tool_edit",
    conversationId: "thread_merge",
    runId: "run_1",
    name: "Edit",
    status: "completed",
    createdSeq: 1,
    versionSeq: 2,
    input: {
      file_path: "/workspace/src/app.ts",
      old_string: "old()",
      new_string: "new()",
    },
  };
  const search: ConversationToolCall = {
    toolCallId: "tool_search",
    conversationId: "thread_merge",
    runId: "run_1",
    name: "WebSearch",
    status: "completed",
    createdSeq: 3,
    versionSeq: 4,
    input: {
      query: "conversation v2 mobile parity",
      mode: "search",
      provider: "brave",
    },
    output: { results: [{ title: "Result", url: "https://example.com" }] },
  };

  const merged = mergeConversationV2IntoProjection(projection([]), v2State([], [], [edit, search]));

  expect(merged.timeline).toHaveLength(2);
  expect(merged.timeline[0]?.metadata?.tool).toMatchObject({
    name: "Edit",
    detail: "/workspace/src/app.ts",
    fileChange: { path: "/workspace/src/app.ts" },
  });
  expect(merged.timeline[1]?.metadata?.tool).toMatchObject({
    name: "WebSearch",
    detail: "conversation v2 mobile parity",
    webSearch: {
      query: "conversation v2 mobile parity",
      mode: "search",
      provider: "brave",
    },
    outputPreview: '{"results":[{"title":"Result","url":"https://example.com"}]}',
  });
});

function assistantMessage(messageId: string, createdSeq: number, body: string): ConversationMessage {
  return {
    ...message(messageId, createdSeq),
    role: "assistant",
    runId: "run_1",
    body,
  };
}

function feedEntryMessageId(entry: ThreadRunProjectionMainFeedEntry): string | undefined {
  if (entry.kind !== "timeline") return undefined;
  const messageId = entry.item.metadata?.conversationV2MessageId;
  return typeof messageId === "string" ? messageId : undefined;
}

test("keeps the V2 order of a turn whose narrative rows left the feed skeleton", () => {
  // The desktop feed skeleton keeps one narrative row per finished segment, so the
  // turn's other messages reach the renderer only through V2 and have no legacy row
  // to anchor to. Their V2 order is what the Feed must show.
  const prompt = legacyUserItem("legacy_prompt", 10);
  prompt.at = "2026-09-16T09:19:38.903Z";
  const keptFinal = legacyAssistantItem("legacy_kept_final", 20);
  keptFinal.scope = "main";
  keptFinal.at = "2026-09-16T09:40:56.925Z";
  keptFinal.metadata = { conversationV2MessageId: "legacy_message_aabbcc03" };
  const base = projection([prompt, keptFinal]);
  base.attempts = [
    {
      attemptId: "run_1",
      phase: "initial",
      retryIndex: 0,
      status: "completed",
      startedAt: "2026-09-16T09:19:40.332Z",
      endedAt: "2026-09-16T09:40:57.629Z",
    },
  ];
  const merged = mergeConversationV2IntoProjection(
    base,
    v2State([
      assistantMessage("legacy_message_c0ffee01", 101, "first"),
      assistantMessage("legacy_message_00beef02", 102, "second"),
      assistantMessage("legacy_message_aabbcc03", 103, "final"),
    ]),
  );
  const viewModel = buildThreadRunProjectionViewModel(merged);
  const sections = buildThreadRunTurnFeedSections(viewModel.mainFeedEntries, merged);
  const turn = sections.find((section) => section.kind === "turn");
  if (turn?.kind !== "turn") {
    throw new Error("expected the merged feed to keep one turn section");
  }

  expect(turn.processEntries.map(feedEntryMessageId)).toEqual([
    "legacy_message_c0ffee01",
    "legacy_message_00beef02",
  ]);
  // The turn's last message stays its final output: with every message collapsed
  // onto one position the feed ordered them by message id instead.
  expect(feedEntryMessageId(turn.finalEntry!)).toBe("legacy_message_aabbcc03");
});

function feedEntryItemIds(entry: ThreadRunProjectionMainFeedEntry): string[] {
  if (entry.kind === "tool-group") {
    return entry.entries.flatMap(feedEntryItemIds);
  }
  return entry.kind === "timeline" || entry.kind === "agent-echo" ? [entry.item.id] : [];
}

test("keeps a V2 tool of a finished turn inside that turn", () => {
  // The feed skeleton drops a finished turn's tool rows, and V2 stores no
  // timestamps, so an unanchored tool used to be stamped with `generatedAt`:
  // every tool of every turn piled onto the bottom of the feed as extra turns.
  const prompt = legacyUserItem("legacy_prompt", 10);
  prompt.at = "2026-09-14T00:00:01.000Z";
  const keptFinal = legacyAssistantItem("legacy_kept_final", 20);
  keptFinal.scope = "main";
  keptFinal.at = "2026-09-14T00:00:20.000Z";
  const base = projection([prompt, keptFinal]);
  base.thread.generatedAt = "2026-09-14T02:00:00.000Z";
  base.attempts = [
    {
      attemptId: "run_1",
      phase: "initial",
      retryIndex: 0,
      status: "completed",
      startedAt: "2026-09-14T00:00:05.000Z",
      endedAt: "2026-09-14T00:00:30.000Z",
    },
  ];
  const tool: ConversationToolCall = {
    toolCallId: "tool_1",
    conversationId: "thread_merge",
    runId: "run_1",
    name: "Bash",
    status: "completed",
    createdSeq: 15,
    versionSeq: 15,
    input: { command: "npm test" },
  };

  const merged = mergeConversationV2IntoProjection(base, v2State([], [], [tool]));

  const toolItem = merged.timeline.find((item) => item.id === "conversation-v2:tool:tool_1");
  expect(toolItem?.at).toBe("2026-09-14T00:00:30.000Z");
  // Just after the row the run kept, not after everything else in the feed.
  expect(toolItem?.sequence).toBe(21);

  const sections = buildThreadRunTurnFeedSections(
    buildThreadRunProjectionViewModel(merged).mainFeedEntries,
    merged,
  );
  expect(sections.filter((section) => section.kind === "turn")).toHaveLength(1);
  const turn = sections.find((section) => section.kind === "turn");
  if (turn?.kind !== "turn") {
    throw new Error("expected the merged feed to keep one turn section");
  }
  expect(
    [...turn.processEntries, ...(turn.finalEntry ? [turn.finalEntry] : [])].flatMap(feedEntryItemIds),
  ).toContain("conversation-v2:tool:tool_1");
});

function subagentMessage(messageId: string, createdSeq: number, agentId: string): ConversationMessage {
  return {
    ...assistantMessage(messageId, createdSeq, "辅助模型已允许 Grep：/repo"),
    agentId,
    agentInstanceId: agentId,
  };
}

function projectionWithAgent(
  timeline: ThreadRunProjectionTimelineItem[],
  agentId: string,
): ThreadRunProjectionSnapshot {
  const base = projection(timeline);
  return {
    ...base,
    agents: [
      {
        agentId,
        role: "planner",
        kind: "planner",
        status: "completed",
        startedAt: "2026-09-14T00:00:00.000Z",
        durationMs: 1_000,
        timeline: [],
      },
    ],
  };
}

test("routes a subagent's V2 narration to its agent card instead of the main feed", () => {
  const owner = "planner:attempt_execution_1";
  const merged = mergeConversationV2MessagesIntoProjection(
    projectionWithAgent([legacyUserItem("legacy_user", 1)], owner),
    v2State([message("message_1", 1), subagentMessage("message_agent", 2, owner)]),
  );

  expect(merged.timeline.map((item) => item.id)).not.toContain("conversation-v2:message_agent");
  const [cardItem] = merged.agents[0]?.timeline ?? [];
  expect(cardItem?.id).toBe("conversation-v2:message_agent");
  expect(cardItem?.scope).toBe("agent");
  expect(cardItem?.agentId).toBe(owner);
});

test("keeps complete V2 message and tool ownership facts in the agent Feed projection", () => {
  const owner = "agent_instance_1";
  const state = v2State(
    [
      {
        messageId: "message_agent_facts",
        conversationId: "thread_merge",
        turnId: "turn_1",
        runId: "run_1",
        role: "assistant",
        channel: "answer",
        createdSeq: 7,
        versionSeq: 9,
        contentVersion: 2,
        body: "agent answer",
        agentId: owner,
        agentInstanceId: owner,
        occurredAt: "2026-09-14T00:00:07.000Z",
        providerRole: "coder",
        status: "final",
        isDeleted: false,
      },
    ],
    [],
    [
      {
        toolCallId: "tool_agent_facts",
        conversationId: "thread_merge",
        runId: "run_1",
        agentId: owner,
        agentInstanceId: owner,
        parentAgentInstanceId: "parent_agent_1",
        parentToolCallId: "parent_tool_1",
        name: "Bash",
        status: "completed",
        createdSeq: 5,
        versionSeq: 6,
        occurredAt: "2026-09-14T00:00:05.000Z",
        providerRole: "coder",
        input: { command: "bun test" },
        output: { exitCode: 0 },
      },
    ],
    [
      {
        agentId: owner,
        conversationId: "thread_merge",
        role: "coder",
        kind: "subagent",
        status: "completed",
        versionSeq: 10,
      },
    ],
  );

  const projection = buildConversationV2OnlyProjection(state, {
    createdAt: "2026-09-14T00:00:00.000Z",
    status: "completed",
  });
  expect(projection.timeline).toEqual([]);
  const rows = projection.agents[0]?.timeline ?? [];
  expect(rows.map((row) => row.id)).toEqual([
    "conversation-v2:tool:tool_agent_facts",
    "conversation-v2:message_agent_facts",
  ]);
  const [tool, messageRow] = rows;
  expect({ scope: tool?.scope, agentId: tool?.agentId, role: tool?.role }).toEqual({
    scope: "agent",
    agentId: owner,
    role: "coder",
  });
  expect(tool?.metadata).toEqual({
    liveType: "tool.completed",
    conversationV2ToolCallId: "tool_agent_facts",
    conversationV2VersionSeq: 6,
    conversationV2AgentInstanceId: owner,
    conversationV2ParentAgentInstanceId: "parent_agent_1",
    conversationV2ParentToolCallId: "parent_tool_1",
    tool: {
      name: "Bash",
      toolUseId: "tool_agent_facts",
      status: "completed",
      detail: "bun test",
      outputPreview: '{"exitCode":0}',
    },
  });
  expect({
    scope: messageRow?.scope,
    agentId: messageRow?.agentId,
    role: messageRow?.role,
    streamKey: messageRow?.streamKey,
    metadata: messageRow?.metadata,
  }).toEqual({
    scope: "agent",
    agentId: owner,
    role: "coder",
    streamKey: "message_agent_facts",
    metadata: {
      conversationV2MessageId: "message_agent_facts",
      conversationV2TurnId: "turn_1",
      conversationV2VersionSeq: 9,
      conversationV2ContentVersion: 2,
      conversationV2Channel: "answer",
      conversationV2Status: "final",
      conversationV2AgentInstanceId: owner,
      logicalEntityId: "message_agent_facts",
    },
  });
});

test("keeps a subagent message in the main feed when no agent card can hold it", () => {
  const merged = mergeConversationV2MessagesIntoProjection(
    projection([legacyUserItem("legacy_user", 1)]),
    v2State([subagentMessage("message_orphan", 2, "planner:missing_card")]),
  );

  const orphan = merged.timeline.find((item) => item.id === "conversation-v2:message_orphan");
  expect(orphan?.scope).toBe("main");
});

test("a legacy subagent row keeps its owner from the adapter to the agent card", () => {
  // The whole pipeline, not just one layer: legacy row → V2 event → read model →
  // renderer merge. A layer that drops the agent identity makes a subagent's
  // narration show up in the main Feed, which is what this test exists to catch.
  const store = new ConversationV2Store(new DatabaseSync(":memory:"));
  store.initialize();
  appendLegacyThreadRunEventToConversationV2(store, {
    id: "legacy_agent_event",
    threadId: "thread_merge",
    sequence: 5,
    eventType: "message.final",
    scope: "agent",
    streamState: "finalized",
    message: "辅助模型已允许 Grep：/repo",
    observedAt: "2026-09-14T00:00:05.000Z",
    role: "coder",
    agentId: "planner:attempt_1",
    runAttemptId: "attempt_1",
    streamKey: "answer_agent",
  });
  const stored = store.bootstrap("thread_merge").messages[0];
  expect(stored).toMatchObject({
    agentId: "planner:attempt_1",
    agentInstanceId: "planner:attempt_1",
  });

  const merged = mergeConversationV2MessagesIntoProjection(
    projectionWithAgent([legacyUserItem("legacy_user", 1)], "planner:attempt_1"),
    v2State([stored as ConversationMessage]),
  );
  expect(merged.timeline.map((item) => item.id)).not.toContain(`conversation-v2:${stored?.messageId}`);
  expect(merged.agents[0]?.timeline.map((item) => item.id)).toEqual([`conversation-v2:${stored?.messageId}`]);
});
