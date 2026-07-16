import { expect, mock, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { buildCodexGatewayModelAlias } from "../src/codex-config-sync.js";
import {
  CodexEventAdapter,
  type CodexThreadRunEventInput,
  replayCodexNotificationFixture,
} from "../src/codex-event-adapter.js";
import { CodexTurnRouteRegistry } from "../src/codex-turn-route-registry.js";

const FIXTURE_PATH = path.resolve(
  import.meta.dir,
  "../../../docs/fixtures/codex-item-stream/plan-turn.jsonl",
);

const ECO_THREAD = "thr_eco_fixture";
const CODEX_THREAD = "thr_codex_fixture_001";

function resolveEcoThreadId(codexThreadId: string): string {
  if (codexThreadId === CODEX_THREAD) {
    return ECO_THREAD;
  }
  return codexThreadId;
}

function collectEvents(
  run: (record: (event: CodexThreadRunEventInput) => void) => void,
): CodexThreadRunEventInput[] {
  const events: CodexThreadRunEventInput[] = [];
  run((event) => events.push(event));
  return events;
}

test("dispatch maps turn/started to run.attempt.started", () => {
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({ resolveEcoThreadId, recordThreadRunEvent: record });
    adapter.dispatch("turn/started", {
      threadId: CODEX_THREAD,
      turn: { id: "turn_001", items: [], status: "inProgress" },
    });
  });

  expect(events).toHaveLength(1);
  expect(events[0]?.eventType).toBe("run.attempt.started");
  expect(events[0]?.threadId).toBe(ECO_THREAD);
  expect(events[0]?.runAttemptId).toBeUndefined();
  expect(events[0]?.metadata?.turnId).toBe("turn_001");
});

test("schema-shaped turn/completed consumes a registered route without notification usage", () => {
  const registry = new CodexTurnRouteRegistry();
  registry.register(CODEX_THREAD, "turn_001", {
    aliasModelId: "eco_custom__vendor-model",
    providerId: "custom",
    upstreamModelId: "vendor-model",
  });
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      turnRouteRegistry: registry,
    });
    adapter.dispatch("turn/completed", {
      threadId: CODEX_THREAD,
      turn: {
        id: "turn_001",
        items: [],
        status: "completed",
      },
    });
  });

  expect(events).toHaveLength(1);
  expect(events[0]?.eventType).toBe("run.attempt.completed");
  expect(events[0]?.metadata?.usage).toBeUndefined();
  expect(events[0]?.metadata?.appServerTokenUsage).toBeUndefined();
  expect(registry.size).toBe(0);
});

test("turn/completed rejects top-level compatibility fields and preserves the exact route", () => {
  const registry = new CodexTurnRouteRegistry();
  registry.register(CODEX_THREAD, "turn_invalid_shape", {
    aliasModelId: "eco_custom__vendor-model",
    providerId: "custom",
    upstreamModelId: "vendor-model",
  });
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      turnRouteRegistry: registry,
    });
    adapter.dispatch("turn/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_invalid_shape",
      status: "completed",
    });
  });

  expect(events).toEqual([]);
  expect(registry.peek(CODEX_THREAD, "turn_invalid_shape")).toBeDefined();
});

test("thread/started rejects top-level and snake_case attribution compatibility fields", () => {
  let recorded = false;
  const adapter = new CodexEventAdapter({
    resolveEcoThreadId,
    recordThreadRunEvent: () => {},
    recordThreadAttribution: () => {
      recorded = true;
    },
  });

  adapter.dispatch("thread/started", {
    threadId: "thr_codex_child_invalid",
    parent_thread_id: CODEX_THREAD,
    agent_role: "explore",
  });

  expect(recorded).toBe(false);
});

test("dispatch emits api.error when turn/completed status is failed", () => {
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({ resolveEcoThreadId, recordThreadRunEvent: record });
    adapter.dispatch("turn/completed", {
      threadId: CODEX_THREAD,
      turn: {
        id: "turn_fail_001",
        items: [],
        status: "failed",
        error: { message: "Model provider eco_custom not found" },
      },
    });
  });

  expect(events.map((event) => event.eventType)).toEqual(["run.attempt.failed", "api.error"]);
  expect(events[1]?.message).toBe("Model provider eco_custom not found");
  expect(events[1]?.metadata?.apiError).toEqual({
    message: "Model provider eco_custom not found",
  });
});

for (const status of ["completed", "failed", "interrupted"] as const) {
  test(`turn/completed status ${status} always clears its registered route`, () => {
    const registry = new CodexTurnRouteRegistry();
    registry.register(CODEX_THREAD, `turn_${status}`, {
      aliasModelId: "eco_custom__vendor-model",
      providerId: "custom",
      upstreamModelId: "vendor-model",
    });
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: () => {},
      turnRouteRegistry: registry,
    });

    adapter.dispatch("turn/completed", {
      threadId: CODEX_THREAD,
      turn: { id: `turn_${status}`, items: [], status },
    });

    expect(registry.size).toBe(0);
  });
}

test("thread/deleted clears pending and active route state", () => {
  const registry = new CodexTurnRouteRegistry();
  registry.registerPending(CODEX_THREAD, {
    aliasModelId: "eco_custom__vendor-model",
    providerId: "custom",
    upstreamModelId: "vendor-model",
  });
  registry.register(CODEX_THREAD, "turn_active", {
    aliasModelId: "eco_custom__vendor-model",
    providerId: "custom",
    upstreamModelId: "vendor-model",
  });
  const adapter = new CodexEventAdapter({
    resolveEcoThreadId,
    recordThreadRunEvent: () => {},
    turnRouteRegistry: registry,
  });

  adapter.dispatch("thread/deleted", { threadId: CODEX_THREAD });

  expect(registry.size).toBe(0);
});

test("tokenUsage is correlated as explicit app-server diagnostics and never creates a bill", () => {
  const registry = new CodexTurnRouteRegistry();
  registry.register(CODEX_THREAD, "turn_bill_001", {
    aliasModelId: "eco_custom__vendor-model",
    providerId: "custom",
    upstreamModelId: "vendor-model",
  });
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      turnRouteRegistry: registry,
    });
    adapter.dispatch("thread/tokenUsage/updated", {
      threadId: CODEX_THREAD,
      turnId: "turn_bill_001",
      tokenUsage: {
        last: {
          inputTokens: 10,
          cachedInputTokens: 2,
          outputTokens: 5,
          reasoningOutputTokens: 1,
          totalTokens: 15,
        },
        total: {
          inputTokens: 10,
          cachedInputTokens: 2,
          outputTokens: 5,
          reasoningOutputTokens: 1,
          totalTokens: 15,
        },
        modelContextWindow: 200_000,
      },
    });
    adapter.dispatch("turn/completed", {
      threadId: CODEX_THREAD,
      turn: {
        id: "turn_bill_001",
        items: [],
        status: "completed",
      },
    });
  });

  expect(events).toHaveLength(1);
  expect(events[0]?.metadata?.appServerTokenUsage).toEqual({
    inputTokens: 10,
    cachedInputTokens: 2,
    outputTokens: 5,
    reasoningOutputTokens: 1,
    totalTokens: 15,
  });
  expect(registry.size).toBe(0);
});

test("historical tokenUsage cannot bind a new pending owner after resume", () => {
  const registry = new CodexTurnRouteRegistry();
  const alias = buildCodexGatewayModelAlias("custom-provider", "vendor-model", "openai_chat_completions");
  const owner = registry.registerPending(CODEX_THREAD, {
    aliasModelId: alias,
    providerId: "custom-provider",
    upstreamModelId: "vendor-model",
    apiCompat: "openai_chat_completions",
  });
  let contextModelId: string | undefined;
  const adapter = new CodexEventAdapter({
    resolveEcoThreadId,
    recordThreadRunEvent: () => {},
    turnRouteRegistry: registry,
    onTokenUsageUpdated: (resolution) => {
      contextModelId = resolution.context.modelId;
    },
  });

  adapter.dispatch("thread/tokenUsage/updated", {
    threadId: CODEX_THREAD,
    turnId: "turn_historical_replay",
    tokenUsage: {
      last: {
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 5,
        reasoningOutputTokens: 0,
        totalTokens: 15,
      },
      total: {
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 5,
        reasoningOutputTokens: 0,
        totalTokens: 15,
      },
      modelContextWindow: 200_000,
    },
  });

  expect(contextModelId).toBeUndefined();
  expect(registry.peek(CODEX_THREAD, "turn_historical_replay")).toBeUndefined();
  expect(registry.size).toBe(1);

  adapter.dispatch("turn/started", {
    threadId: CODEX_THREAD,
    turn: { id: "turn_current", items: [], status: "inProgress" },
  });
  expect(registry.peek(CODEX_THREAD, "turn_current")).toBeUndefined();
  expect(registry.size).toBe(1);
  expect(registry.bindPending(owner, "turn_current")?.aliasModelId).toBe(alias);
});

test("turn/started cannot consume a pending route without its owner", () => {
  const registry = new CodexTurnRouteRegistry();
  const route = {
    aliasModelId: "eco_custom__vendor-model",
    providerId: "custom",
    upstreamModelId: "vendor-model",
  };
  registry.register(CODEX_THREAD, "turn_old", route);
  registry.consume(CODEX_THREAD, "turn_old");
  const owner = registry.registerPending(CODEX_THREAD, route);
  const adapter = new CodexEventAdapter({
    resolveEcoThreadId,
    recordThreadRunEvent: () => {},
    turnRouteRegistry: registry,
  });

  adapter.dispatch("turn/started", {
    threadId: CODEX_THREAD,
    turn: { id: "turn_old", items: [], status: "inProgress" },
  });

  expect(registry.peek(CODEX_THREAD, "turn_old")).toBeUndefined();
  expect(registry.size).toBe(1);
  expect(registry.bindPending(owner, "turn_current")?.turnId).toBe("turn_current");
});

test("tokenUsage context uses the registered V1 route and ignores fake completion model fields", () => {
  const registry = new CodexTurnRouteRegistry();
  const alias = buildCodexGatewayModelAlias("custom-provider", "vendor-model", "openai_chat_completions");
  registry.register(CODEX_THREAD, "turn_bill_model", {
    aliasModelId: alias,
    providerId: "custom-provider",
    upstreamModelId: "vendor-model",
    apiCompat: "openai_chat_completions",
  });
  let contextUpdate: unknown;
  const adapter = new CodexEventAdapter({
    resolveEcoThreadId,
    recordThreadRunEvent: () => {},
    turnRouteRegistry: registry,
    onTokenUsageUpdated: (resolution) => {
      contextUpdate = resolution;
    },
  });
  adapter.dispatch("thread/tokenUsage/updated", {
    threadId: CODEX_THREAD,
    turnId: "turn_bill_model",
    tokenUsage: {
      last: {
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 5,
        reasoningOutputTokens: 0,
        totalTokens: 15,
      },
      total: {
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 5,
        reasoningOutputTokens: 0,
        totalTokens: 15,
      },
      modelContextWindow: 200_000,
    },
  });
  adapter.dispatch("turn/completed", {
    threadId: CODEX_THREAD,
    turn: {
      id: "turn_bill_model",
      items: [],
      status: "completed",
      modelId: "wrong-model-from-non-schema-fixture",
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  });

  expect((contextUpdate as { context?: { modelId?: string } }).context?.modelId).toBe("vendor-model");
  expect(registry.size).toBe(0);
});

test("dispatch merges agentMessage deltas on stable streamKey (itemId)", () => {
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({ resolveEcoThreadId, recordThreadRunEvent: record });
    adapter.dispatch("item/agentMessage/delta", {
      threadId: CODEX_THREAD,
      turnId: "turn_001",
      itemId: "item_agent_001",
      delta: "Hello ",
    });
    adapter.dispatch("item/agentMessage/delta", {
      threadId: CODEX_THREAD,
      turnId: "turn_001",
      itemId: "item_agent_001",
      delta: "world",
    });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_001",
      item: { type: "agentMessage", id: "item_agent_001", text: "Hello world" },
    });
  });

  const deltas = events.filter((event) => event.eventType === "message.delta");
  const finalMessage = events.find((event) => event.eventType === "message.final");

  expect(deltas).toHaveLength(2);
  expect(deltas[0]?.message).toBe("Hello ");
  expect(deltas[1]?.message).toBe("Hello world");
  expect(deltas.every((event) => event.streamKey === "item_agent_001")).toBe(true);
  expect(deltas.every((event) => event.metadata?.logicalEntityId === "item_agent_001")).toBe(true);
  expect(deltas.every((event) => event.streamState === "streaming")).toBe(true);
  expect(finalMessage?.streamKey).toBe("item_agent_001");
  expect(finalMessage?.message).toBe("Hello world");
  expect(finalMessage?.role).toBe("assistant");
});

test("dispatch maps userMessage completed with clientId", () => {
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({ resolveEcoThreadId, recordThreadRunEvent: record });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_001",
      item: {
        type: "userMessage",
        id: "item_user_001",
        clientId: "msg_eco_opt_1",
        content: [{ type: "text", text: "Summarize README" }],
      },
    });
  });

  expect(events).toHaveLength(1);
  expect(events[0]?.role).toBe("user");
  expect(events[0]?.message).toBe("Summarize README");
  expect(events[0]?.metadata?.liveType).toBe("message.user");
  expect(events[0]?.metadata?.clientUserMessageId).toBe("msg_eco_opt_1");
  expect(events[0]?.metadata?.rewindTarget).toEqual({
    activityLineId: "item_user_001",
    userMessageId: "item_user_001",
  });
  expect(events[0]?.streamKey).toBe("item_user_001");
});

test("plan-turn.jsonl fixture replays to expected ThreadRunEvent sequence", () => {
  const fixture = fs.readFileSync(FIXTURE_PATH, "utf8");
  const events = replayCodexNotificationFixture(fixture, {
    resolveEcoThreadId,
    recordThreadRunEvent: () => {},
    now: () => "2026-07-03T12:00:00.000Z",
  });

  expect(events.map((event) => event.eventType)).toEqual([
    "run.attempt.started",
    "message.final",
    "message.delta",
    "message.delta",
    "message.final",
    "run.attempt.completed",
  ]);

  expect(events.every((event) => event.threadId === ECO_THREAD)).toBe(true);

  const completed = events.find((event) => event.eventType === "run.attempt.completed");
  expect(completed?.runAttemptId).toBeUndefined();
  expect(completed?.metadata?.turnId).toBe("turn_fixture_001");
  expect(completed?.metadata?.status).toBe("completed");

  const userMessage = events.find((event) => event.metadata?.liveType === "message.user");
  expect(userMessage?.metadata?.clientUserMessageId).toBe("msg_eco_optimistic_fixture_001");
  expect(userMessage?.message).toContain("Read README.md");
});

test("dispatch maps collabAgentToolCall spawn_agent item/started to agent.started", () => {
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      dequeueSpawnPayloadMatching: ({ toolUseId }) =>
        toolUseId === "item_spawn_001" ? { agentRole: "explore", toolUseId } : undefined,
    });
    adapter.dispatch("item/started", {
      threadId: CODEX_THREAD,
      turnId: "turn_spawn_001",
      item: {
        type: "collabAgentToolCall",
        id: "item_spawn_001",
        tool: "spawnAgent",
        status: "inProgress",
        senderThreadId: CODEX_THREAD,
        receiverThreadIds: ["thr_codex_child_001"],
        prompt: "Explore the auth module and list key entry points.",
      },
    });
  });

  expect(events).toHaveLength(1);
  expect(events[0]?.eventType).toBe("agent.started");
  expect(events[0]?.scope).toBe("agent");
  expect(events[0]?.role).toBe("explore");
  expect(events[0]?.agentId).toBe("thr_codex_child_001");
  expect(events[0]?.parentToolUseId).toBe("item_spawn_001");
  expect(events[0]?.metadata?.codexNewThreadId).toBe("thr_codex_child_001");
  expect(events[0]?.metadata?.delegationPrompt).toBe("Explore the auth module and list key entry points.");
});

test("dispatch maps completed spawnAgent item to agent.started until the child turn completes", () => {
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({ resolveEcoThreadId, recordThreadRunEvent: record });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_spawn_001",
      item: {
        type: "collabAgentToolCall",
        id: "item_spawn_001",
        tool: "spawnAgent",
        status: "completed",
        senderThreadId: CODEX_THREAD,
        receiverThreadIds: ["thr_codex_child_001"],
      },
    });
  });

  expect(events).toHaveLength(1);
  expect(events[0]?.eventType).toBe("agent.started");
  expect(events[0]?.scope).toBe("agent");
  expect(events[0]?.agentId).toBe("thr_codex_child_001");
});

test("collabAgentToolCall completed consumes queued Profile role when completed carries child thread id", () => {
  const attributions: Array<{ codexThreadId: string; record: Record<string, unknown> }> = [];
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      recordThreadAttribution: (codexThreadId, attribution) => {
        attributions.push({ codexThreadId, record: attribution });
      },
      dequeueSpawnPayloadMatching: ({ toolUseId }) =>
        toolUseId === "item_spawn_completed_only"
          ? {
              agentRole: "coder",
              message: "Suggest a scoped implementation step",
              toolUseId,
            }
          : undefined,
    });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_spawn_completed_only",
      item: {
        type: "collabAgentToolCall",
        id: "item_spawn_completed_only",
        tool: "spawnAgent",
        status: "completed",
        senderThreadId: CODEX_THREAD,
        receiverThreadIds: ["thr_codex_child_completed_only"],
      },
    });
  });

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    eventType: "agent.started",
    scope: "agent",
    agentId: "thr_codex_child_completed_only",
    role: "coder",
    metadata: {
      agentRole: "coder",
      profileRole: "coder",
      delegationPrompt: "Suggest a scoped implementation step",
    },
  });
  expect(attributions).toEqual([
    {
      codexThreadId: "thr_codex_child_completed_only",
      record: {
        parentThreadId: CODEX_THREAD,
        agentRole: "coder",
        spawnCallId: "item_spawn_completed_only",
        spawnMessage: "Suggest a scoped implementation step",
      },
    },
  ]);
});

test("collabAgentToolCall completed ignores non-schema item role and uses queued role", () => {
  const attributions: Array<{ codexThreadId: string; record: Record<string, unknown> }> = [];
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      recordThreadAttribution: (codexThreadId, attribution) => {
        attributions.push({ codexThreadId, record: attribution });
      },
      dequeueSpawnPayloadMatching: ({ toolUseId }) =>
        toolUseId === "item_spawn_inherited_role"
          ? {
              agentRole: "coder",
              message: "Suggest a scoped implementation step",
              taskName: "coder",
              toolUseId,
            }
          : undefined,
    });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_spawn_inherited_role",
      item: {
        type: "collabAgentToolCall",
        id: "item_spawn_inherited_role",
        tool: "spawnAgent",
        status: "completed",
        senderThreadId: CODEX_THREAD,
        receiverThreadIds: ["thr_codex_child_inherited_role"],
        agentRole: "explore",
      },
    });
  });

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    eventType: "agent.started",
    agentId: "thr_codex_child_inherited_role",
    role: "coder",
    metadata: {
      agentRole: "coder",
      profileRole: "coder",
      delegationPrompt: "Suggest a scoped implementation step",
    },
  });
  expect(attributions).toEqual([
    {
      codexThreadId: "thr_codex_child_inherited_role",
      record: {
        parentThreadId: CODEX_THREAD,
        agentRole: "coder",
        spawnCallId: "item_spawn_inherited_role",
        spawnMessage: "Suggest a scoped implementation step",
      },
    },
  ]);
});

test("collabAgentToolCall completed matches queued payload over stale attribution role", () => {
  const attributions: Array<{ codexThreadId: string; record: Record<string, unknown> }> = [];
  const matchingInputs: unknown[] = [];
  const childThreadId = "thr_codex_child_stale_attribution";
  const spawnMessage = "Implement the Codex usage ledger attribution fix.";
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      getThreadAttributionRecord: (codexThreadId) => {
        if (codexThreadId !== childThreadId) {
          return undefined;
        }
        return {
          parentThreadId: CODEX_THREAD,
          agentRole: "explore",
          spawnCallId: "item_spawn_previous",
          spawnMessage,
        };
      },
      recordThreadAttribution: (codexThreadId, attribution) => {
        attributions.push({ codexThreadId, record: attribution });
      },
      dequeueSpawnPayloadMatching: (input) => {
        matchingInputs.push(input);
        if (input.toolUseId === "item_spawn_stale_attribution") {
          return {
            agentRole: "coder",
            message: spawnMessage,
            taskName: "implementation_fix",
            toolUseId: "item_spawn_stale_attribution",
          };
        }
        return undefined;
      },
    });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_spawn_stale_attribution",
      item: {
        type: "collabAgentToolCall",
        id: "item_spawn_stale_attribution",
        tool: "spawnAgent",
        status: "completed",
        senderThreadId: CODEX_THREAD,
        receiverThreadIds: [childThreadId],
      },
    });
  });

  expect(matchingInputs).toEqual([
    {
      toolUseId: "item_spawn_stale_attribution",
    },
  ]);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    eventType: "agent.started",
    agentId: childThreadId,
    role: "coder",
    metadata: {
      agentRole: "coder",
      profileRole: "coder",
      delegationPrompt: spawnMessage,
    },
  });
  expect(attributions).toEqual([
    {
      codexThreadId: childThreadId,
      record: {
        parentThreadId: CODEX_THREAD,
        agentRole: "coder",
        spawnCallId: "item_spawn_stale_attribution",
        spawnMessage,
      },
    },
  ]);
});

test("collabAgentToolCall started without child thread id does not consume queued role", () => {
  let payloadDequeues = 0;
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      dequeueSpawnPayloadMatching: () => {
        payloadDequeues += 1;
        return { agentRole: "explore" };
      },
    });
    adapter.dispatch("item/started", {
      threadId: CODEX_THREAD,
      turnId: "turn_spawn_started_no_child",
      item: {
        type: "collabAgentToolCall",
        id: "item_spawn_started_no_child",
        tool: "spawnAgent",
        status: "inProgress",
        senderThreadId: CODEX_THREAD,
      },
    });
  });

  expect(events).toEqual([]);
  expect(payloadDequeues).toBe(0);
});

test("dispatch records parent link and general display role when spawn omits agent_type", () => {
  const attributions: Array<{ codexThreadId: string; record: Record<string, unknown> }> = [];
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      recordThreadAttribution: (codexThreadId, attribution) => {
        attributions.push({ codexThreadId, record: attribution });
      },
    });
    adapter.dispatch("item/started", {
      threadId: CODEX_THREAD,
      turnId: "turn_spawn_missing_role",
      item: {
        type: "collabAgentToolCall",
        id: "item_spawn_missing_role",
        tool: "spawnAgent",
        status: "inProgress",
        senderThreadId: CODEX_THREAD,
        receiverThreadIds: ["thr_codex_child_missing_role"],
      },
    });
  });

  expect(events.map((event) => event.eventType)).toEqual(["agent.started"]);
  expect(events[0]).toMatchObject({
    threadId: ECO_THREAD,
    agentId: "thr_codex_child_missing_role",
    role: "general",
    eventType: "agent.started",
  });
  expect(attributions).toEqual([
    {
      codexThreadId: "thr_codex_child_missing_role",
      record: {
        parentThreadId: CODEX_THREAD,
        agentRole: "general",
        spawnCallId: "item_spawn_missing_role",
      },
    },
  ]);
});

test("subAgentActivity started with queued Profile role opens agent.started", () => {
  const attributions: Array<{ codexThreadId: string; record: Record<string, unknown> }> = [];
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      recordThreadAttribution: (codexThreadId, attribution) => {
        attributions.push({ codexThreadId, record: attribution });
      },
      resolveThreadAttribution: (codexThreadId) => {
        const hit = attributions.find((entry) => entry.codexThreadId === codexThreadId);
        if (!hit?.record.parentThreadId) {
          return undefined;
        }
        return {
          ecoThreadId: ECO_THREAD,
          billingRole: "explore",
          parentEcoThreadId: ECO_THREAD,
          isSubagentThread: true,
          agentId: codexThreadId,
        };
      },
      dequeueSpawnPayloadMatching: ({ toolUseId }) =>
        toolUseId === "item_sub_activity_role"
          ? {
              agentRole: "explore",
              message: "Scan weather for Guangzhou",
              taskName: "weather_check",
              toolUseId,
            }
          : undefined,
    });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_parent_spawn",
      item: {
        type: "subAgentActivity",
        id: "item_sub_activity_role",
        kind: "started",
        agentThreadId: "thr_codex_child_explore_v2",
        agentPath: "/root/weather_check",
      },
    });
  });

  expect(events.map((event) => event.eventType)).toEqual(["agent.started"]);
  expect(events[0]).toMatchObject({
    threadId: ECO_THREAD,
    agentId: "thr_codex_child_explore_v2",
    role: "explore",
    eventType: "agent.started",
    metadata: {
      delegationPrompt: "Scan weather for Guangzhou",
    },
  });
});

test("subAgentActivity started consumes queued spawn payload only once", () => {
  const queued = [
    {
      agentRole: "explore",
      message: "Explore the repository shape",
      taskName: "repo_scan",
    },
    {
      agentRole: "coder",
      message: "Suggest an implementation path",
      taskName: "implementation_hint",
    },
  ];
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      recordThreadAttribution: () => {},
      dequeueSpawnPayloadMatching: ({ toolUseId }) => {
        const index = toolUseId === "item_sub_activity_single_dequeue" ? 0 : -1;
        return index < 0 ? undefined : queued.splice(index, 1)[0];
      },
    });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_parent_spawn",
      item: {
        type: "subAgentActivity",
        id: "item_sub_activity_single_dequeue",
        kind: "started",
        agentThreadId: "thr_codex_child_single_dequeue",
        agentPath: "/root/repo_scan",
      },
    });
  });

  expect(events[0]).toMatchObject({
    agentId: "thr_codex_child_single_dequeue",
    role: "explore",
    metadata: {
      delegationPrompt: "Explore the repository shape",
    },
  });
  expect(queued.map((entry) => entry.agentRole)).toEqual(["coder"]);
});

test("subAgentActivity started accepts queued custom Profile role", () => {
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      recordThreadAttribution: () => {},
      profileRoleIds: ["Deep_Research"],
      dequeueSpawnPayloadMatching: ({ toolUseId }) =>
        toolUseId === "item_sub_activity_custom_role"
          ? {
              agentRole: "deep_research",
              message: "Investigate integration risks",
              taskName: "integration_risks",
              toolUseId,
            }
          : undefined,
    });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_parent_spawn",
      item: {
        type: "subAgentActivity",
        id: "item_sub_activity_custom_role",
        kind: "started",
        agentThreadId: "thr_codex_child_deep_research",
        agentPath: "/root/integration_risks",
      },
    });
  });

  expect(events[0]).toMatchObject({
    agentId: "thr_codex_child_deep_research",
    role: "Deep_Research",
    metadata: {
      profileRole: "Deep_Research",
      delegationPrompt: "Investigate integration risks",
    },
  });
});

test("subAgentActivity started without agent_type displays general", () => {
  const attributions: Array<{ codexThreadId: string; record: Record<string, unknown> }> = [];
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      recordThreadAttribution: (codexThreadId, attribution) => {
        attributions.push({ codexThreadId, record: attribution });
      },
    });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_parent_spawn",
      item: {
        type: "subAgentActivity",
        id: "item_sub_activity_general",
        kind: "started",
        agentThreadId: "thr_codex_child_general",
        agentPath: "/root/task_1",
      },
    });
  });

  expect(events.map((event) => event.eventType)).toEqual(["agent.started"]);
  expect(events[0]).toMatchObject({
    threadId: ECO_THREAD,
    agentId: "thr_codex_child_general",
    role: "general",
    eventType: "agent.started",
  });
});

test("thread/started does not use preview text as role attribution evidence", () => {
  const queued = [
    {
      agentRole: "explore",
      message: "Scan repository top-level folders",
      taskName: "top_level_scan",
    },
  ];
  const attributions: Array<{ codexThreadId: string; record: Record<string, unknown> }> = [];
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      recordThreadAttribution: (codexThreadId, attribution) => {
        attributions.push({ codexThreadId, record: attribution });
      },
      resolveThreadAttribution: (codexThreadId) => {
        const hit = attributions.find((entry) => entry.codexThreadId === codexThreadId);
        if (!hit?.record.parentThreadId) {
          return undefined;
        }
        return {
          ecoThreadId: ECO_THREAD,
          billingRole: "explore",
          parentEcoThreadId: ECO_THREAD,
          isSubagentThread: true,
          agentId: codexThreadId,
        };
      },
      dequeueSpawnPayloadMatching: () => queued.shift(),
    });
    adapter.dispatch("thread/started", {
      thread: {
        id: "thr_codex_child_thread_started_queue",
        parentThreadId: CODEX_THREAD,
        preview: "Scan repository top-level folders",
      },
    });
  });

  expect(events).toEqual([]);
  expect(attributions).toEqual([
    {
      codexThreadId: "thr_codex_child_thread_started_queue",
      record: {
        parentThreadId: CODEX_THREAD,
        agentRole: "general",
        spawnMessage: "Scan repository top-level folders",
      },
    },
  ]);
  expect(queued).toHaveLength(1);
});

test("thread/started without role evidence waits for subAgentActivity call_id before emitting", () => {
  const attributionByThread = new Map<string, Record<string, unknown>>();
  let recordedEvents = 0;
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: (event) => {
        recordedEvents += 1;
        record(event);
      },
      getThreadAttributionRecord: (codexThreadId) =>
        attributionByThread.get(codexThreadId) as never,
      recordThreadAttribution: (codexThreadId, attribution) => {
        attributionByThread.set(codexThreadId, attribution);
      },
      dequeueSpawnPayloadMatching: ({ toolUseId }) =>
        toolUseId === "call_precise_role"
          ? {
              agentRole: "coder",
              message: "Implement the precise fix",
              taskName: "precise_fix",
              toolUseId,
            }
          : undefined,
    });

    adapter.dispatch("thread/started", {
      thread: {
        id: "thr_codex_child_precise_role",
        parentThreadId: CODEX_THREAD,
      },
    });
    expect(recordedEvents).toBe(0);

    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_parent_precise_role",
      item: {
        type: "subAgentActivity",
        id: "call_precise_role",
        kind: "started",
        agentThreadId: "thr_codex_child_precise_role",
        agentPath: "/root/precise_fix",
      },
    });
  });

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    eventType: "agent.started",
    agentId: "thr_codex_child_precise_role",
    role: "coder",
    metadata: {
      profileRole: "coder",
      delegationPrompt: "Implement the precise fix",
    },
  });
  expect(attributionByThread.get("thr_codex_child_precise_role")).toMatchObject({
    parentThreadId: CODEX_THREAD,
    agentRole: "coder",
    spawnCallId: "call_precise_role",
  });
});

test("thread/started does not infer a custom Profile role from preview text", () => {
  const queued = [
    {
      agentRole: "researcher",
      message: "Find the risky Codex integration path",
    },
  ];
  const attributions: Array<{ codexThreadId: string; record: Record<string, unknown> }> = [];
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      recordThreadAttribution: (codexThreadId, attribution) => {
        attributions.push({ codexThreadId, record: attribution });
      },
      resolveThreadAttribution: (codexThreadId) => {
        const hit = attributions.find((entry) => entry.codexThreadId === codexThreadId);
        if (!hit?.record.parentThreadId) {
          return undefined;
        }
        return {
          ecoThreadId: ECO_THREAD,
          billingRole: "researcher",
          parentEcoThreadId: ECO_THREAD,
          isSubagentThread: true,
          agentId: codexThreadId,
        };
      },
      resolveProfileRoleIds: () => ["researcher"],
      dequeueSpawnPayloadMatching: () => queued.shift(),
    });
    adapter.dispatch("thread/started", {
      thread: {
        id: "thr_codex_child_researcher",
        parentThreadId: CODEX_THREAD,
        preview: "Find the risky Codex integration path",
      },
    });
  });

  expect(events).toEqual([]);
  expect(attributions[0]).toEqual({
    codexThreadId: "thr_codex_child_researcher",
    record: {
      parentThreadId: CODEX_THREAD,
      agentRole: "general",
      spawnMessage: "Find the risky Codex integration path",
    },
  });
  expect(queued).toHaveLength(1);
});

test("thread/started with explicit Profile role does not consume queued payload", () => {
  let payloadDequeues = 0;
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      recordThreadAttribution: () => {},
      dequeueSpawnPayloadMatching: () => {
        payloadDequeues += 1;
        return { agentRole: "coder", message: "Should stay queued" };
      },
    });
    adapter.dispatch("thread/started", {
      thread: {
        id: "thr_codex_child_explicit_role",
        parentThreadId: CODEX_THREAD,
        agentRole: "explore",
      },
    });
  });

  expect(events[0]).toMatchObject({
    agentId: "thr_codex_child_explicit_role",
    role: "explore",
  });
  expect(payloadDequeues).toBe(0);
});

test("child subagent turn/completed emits agent.stopped on parent without run.attempt.failed", () => {
  const attributions: Array<{ codexThreadId: string; record: Record<string, unknown> }> = [];
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      recordThreadAttribution: (codexThreadId, attribution) => {
        attributions.push({ codexThreadId, record: attribution });
      },
      getThreadAttributionRecord: (codexThreadId) => {
        const hit = attributions.find((entry) => entry.codexThreadId === codexThreadId);
        return hit?.record as { parentThreadId: string; agentRole?: string; spawnCallId?: string };
      },
      resolveThreadAttribution: (codexThreadId) => {
        if (codexThreadId === "thr_codex_child_done") {
          return {
            ecoThreadId: ECO_THREAD,
            billingRole: "explore",
            parentEcoThreadId: ECO_THREAD,
            isSubagentThread: true,
            agentId: codexThreadId,
          };
        }
        return undefined;
      },
    });
    attributions.push({
      codexThreadId: "thr_codex_child_done",
      record: {
        parentThreadId: CODEX_THREAD,
        agentRole: "explore",
        spawnCallId: "item_spawn_done",
      },
    });
    adapter.dispatch("turn/completed", {
      threadId: "thr_codex_child_done",
      turn: { id: "turn_child_done", status: "completed" },
    });
  });

  expect(events.map((event) => event.eventType)).toEqual(["agent.stopped"]);
  expect(events[0]).toMatchObject({
    threadId: ECO_THREAD,
    agentId: "thr_codex_child_done",
    role: "explore",
    eventType: "agent.stopped",
  });
});

test("child subagent turn/completed emits agent.stopped without persisted agentRole", () => {
  const attributions: Array<{ codexThreadId: string; record: Record<string, unknown> }> = [];
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      recordThreadAttribution: (codexThreadId, attribution) => {
        attributions.push({ codexThreadId, record: attribution });
      },
      getThreadAttributionRecord: (codexThreadId) => {
        const hit = attributions.find((entry) => entry.codexThreadId === codexThreadId);
        return hit?.record as { parentThreadId: string; agentRole?: string; spawnCallId?: string };
      },
      resolveThreadAttribution: (codexThreadId) => {
        if (codexThreadId === "thr_codex_child_no_role") {
          return {
            ecoThreadId: ECO_THREAD,
            billingRole: "coder",
            parentEcoThreadId: ECO_THREAD,
            isSubagentThread: true,
            agentId: codexThreadId,
          };
        }
        return undefined;
      },
    });
    attributions.push({
      codexThreadId: "thr_codex_child_no_role",
      record: {
        parentThreadId: CODEX_THREAD,
        spawnCallId: "item_spawn_no_role",
      },
    });
    adapter.dispatch("turn/completed", {
      threadId: "thr_codex_child_no_role",
      turn: { id: "turn_child_no_role", status: "completed" },
    });
  });

  expect(events.map((event) => event.eventType)).toEqual(["agent.stopped"]);
  expect(events[0]).toMatchObject({
    threadId: ECO_THREAD,
    agentId: "thr_codex_child_no_role",
    role: "general",
    eventType: "agent.stopped",
  });
});

test("subAgentActivity with task_name path opens general agent card", () => {
  const attributions: Array<{ codexThreadId: string; record: Record<string, unknown> }> = [];
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      recordThreadAttribution: (codexThreadId, attribution) => {
        attributions.push({ codexThreadId, record: attribution });
      },
      resolveThreadAttribution: (codexThreadId) => {
        const hit = attributions.find((entry) => entry.codexThreadId === codexThreadId);
        if (!hit) {
          return undefined;
        }
        return {
          ecoThreadId: ECO_THREAD,
          billingRole: "coder",
          parentEcoThreadId: ECO_THREAD,
          isSubagentThread: true,
          agentId: codexThreadId,
        };
      },
    });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_parent_spawn",
      item: {
        type: "subAgentActivity",
        id: "item_sub_activity_001",
        kind: "started",
        agentThreadId: "thr_codex_child_live",
        agentPath: "/root/weather_check",
      },
    });
    adapter.dispatch("turn/started", {
      threadId: "thr_codex_child_live",
      turn: { id: "turn_child_live", status: "inProgress" },
    });
  });

  expect(attributions).toEqual([
    {
      codexThreadId: "thr_codex_child_live",
      record: {
        parentThreadId: CODEX_THREAD,
        agentRole: "general",
        spawnCallId: "item_sub_activity_001",
        spawnMessage: "weather_check",
      },
    },
  ]);
  expect(events.map((event) => event.eventType)).toEqual(["agent.started", "run.attempt.started"]);
  expect(events[0]).toMatchObject({
    threadId: ECO_THREAD,
    agentId: "thr_codex_child_live",
    role: "general",
    eventType: "agent.started",
  });
});

test("subAgentActivity started uses dequeued spawn message for card mission text", () => {
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      recordThreadAttribution: () => {},
      dequeueSpawnPayloadMatching: ({ toolUseId }) =>
        toolUseId === "item_sub_activity_msg"
          ? {
              message: "Find all API entry points under src/auth",
              taskName: "auth_scan",
              toolUseId,
            }
          : undefined,
    });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_parent_spawn",
      item: {
        type: "subAgentActivity",
        id: "item_sub_activity_msg",
        kind: "started",
        agentThreadId: "thr_codex_child_msg",
        agentPath: "/root/auth_scan",
      },
    });
  });

  expect(events[0]?.metadata?.delegationPrompt).toBe("Find all API entry points under src/auth");
});

test("thread/started with agentRole opens agent.started card on parent eco thread", () => {
  const attributions: Array<{ codexThreadId: string; record: Record<string, unknown> }> = [];
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      recordThreadAttribution: (codexThreadId, attribution) => {
        attributions.push({ codexThreadId, record: attribution });
        adapter.flushPendingEventsForThread(codexThreadId);
      },
      resolveThreadAttribution: (codexThreadId) => {
        const hit = attributions.find((entry) => entry.codexThreadId === codexThreadId);
        if (!hit?.record.parentThreadId) {
          return undefined;
        }
        return {
          ecoThreadId: ECO_THREAD,
          billingRole: "explore",
          parentEcoThreadId: ECO_THREAD,
          isSubagentThread: true,
          agentId: codexThreadId,
        };
      },
    });
    adapter.dispatch("thread/started", {
      thread: {
        id: "thr_codex_child_role",
        parentThreadId: CODEX_THREAD,
        agentRole: "explore",
      },
    });
  });

  expect(attributions).toEqual([
    {
      codexThreadId: "thr_codex_child_role",
      record: {
        parentThreadId: CODEX_THREAD,
        agentRole: "explore",
      },
    },
  ]);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    threadId: ECO_THREAD,
    eventType: "agent.started",
    agentId: "thr_codex_child_role",
    role: "explore",
    scope: "agent",
  });
});

test("ignores self-parent subAgentActivity so planner thinking stays on main scope", () => {
  const attributions: Array<{ codexThreadId: string; record: Record<string, unknown> }> = [];
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      recordThreadAttribution: (codexThreadId, attribution) => {
        attributions.push({ codexThreadId, record: attribution });
      },
      resolveThreadAttribution: (codexThreadId) => {
        if (codexThreadId !== CODEX_THREAD) {
          return undefined;
        }
        return {
          ecoThreadId: ECO_THREAD,
          billingRole: "planner",
        };
      },
    });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_self_parent",
      item: {
        type: "subAgentActivity",
        id: "item_self_parent",
        kind: "started",
        agentThreadId: CODEX_THREAD,
        agentPath: "/root/explore",
      },
    });
    adapter.dispatch("item/reasoning/textDelta", {
      threadId: CODEX_THREAD,
      turnId: "turn_self_parent",
      itemId: "item_main_think",
      delta: "planner thinking",
    });
  });

  expect(attributions).toEqual([]);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    threadId: ECO_THREAD,
    eventType: "thinking.delta",
    scope: "main",
    message: "planner thinking",
  });
  expect(events[0]?.agentId).toBeUndefined();
});

test("dispatch reads structured reasoning summary text on item completion", () => {
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({ resolveEcoThreadId, recordThreadRunEvent: record });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_reasoning_summary",
      item: {
        type: "reasoning",
        id: "item_reasoning_summary",
        summary: [
          { type: "summary_text", text: "先定位事件合并。" },
          { type: "summary_text", text: "再检查 Feed 投影。" },
        ],
        encryptedContent: "opaque",
      },
    });
  });

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    eventType: "thinking.final",
    message: "先定位事件合并。\n再检查 Feed 投影。",
    streamKey: "item_reasoning_summary",
  });
});

test("dispatch records duration for each completed reasoning item", () => {
  let now = "2026-01-01T00:00:01.000Z";
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      now: () => now,
    });
    adapter.dispatch("item/started", {
      threadId: CODEX_THREAD,
      turnId: "turn_reasoning_duration",
      item: { type: "reasoning", id: "item_reasoning_duration" },
    });
    now = "2026-01-01T00:00:02.500Z";
    adapter.dispatch("item/reasoning/textDelta", {
      threadId: CODEX_THREAD,
      turnId: "turn_reasoning_duration",
      itemId: "item_reasoning_duration",
      delta: "检查事件时间。",
    });
    now = "2026-01-01T00:00:05.250Z";
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_reasoning_duration",
      item: {
        type: "reasoning",
        id: "item_reasoning_duration",
        summary: [{ type: "summary_text", text: "检查事件时间。" }],
      },
    });
  });

  expect(events.find((event) => event.eventType === "thinking.final")?.metadata).toMatchObject({
    thinkingDurationMs: 4250,
  });
});

test("buffers child events until parent eco mapping is known then flushes", () => {
  const parentMapped = { value: false };
  const attributions = new Map<string, { parentThreadId: string; agentRole?: string }>();
  const events: Array<{ threadId: string; eventType: string; agentId?: string; scope: string }> = [];
  const resolveAttribution = (codexThreadId: string) => {
    const record = attributions.get(codexThreadId);
    if (!record?.parentThreadId) {
      return undefined;
    }
    if (!parentMapped.value) {
      return undefined;
    }
    return {
      ecoThreadId: ECO_THREAD,
      billingRole: "explore" as const,
      parentEcoThreadId: ECO_THREAD,
      isSubagentThread: true,
      agentId: codexThreadId,
    };
  };
  const adapter = new CodexEventAdapter({
    resolveEcoThreadId: (codexThreadId) => {
      if (codexThreadId === CODEX_THREAD && parentMapped.value) {
        return ECO_THREAD;
      }
      return resolveAttribution(codexThreadId)?.ecoThreadId ?? codexThreadId;
    },
    resolveThreadAttribution: resolveAttribution,
    recordThreadAttribution: (codexThreadId, record) => {
      attributions.set(codexThreadId, record);
      adapter.flushPendingEventsForThread(codexThreadId);
    },
    recordThreadRunEvent: (event) => {
      events.push({
        threadId: event.threadId,
        eventType: event.eventType,
        scope: event.scope,
        ...(event.agentId && { agentId: event.agentId }),
      });
    },
  });

  adapter.dispatch("thread/started", {
    thread: {
      id: "thr_codex_child_wait_parent",
      parentThreadId: CODEX_THREAD,
      agentRole: "explore",
    },
  });
  adapter.dispatch("item/reasoning/textDelta", {
    threadId: "thr_codex_child_wait_parent",
    turnId: "turn_child_wait",
    itemId: "item_child_think_wait",
    delta: "child thinking",
  });
  expect(events).toHaveLength(0);

  parentMapped.value = true;
  adapter.flushAllPendingEvents();

  expect(events).toEqual([
    {
      threadId: ECO_THREAD,
      eventType: "agent.started",
      scope: "agent",
      agentId: "thr_codex_child_wait_parent",
    },
    {
      threadId: ECO_THREAD,
      eventType: "thinking.delta",
      scope: "agent",
      agentId: "thr_codex_child_wait_parent",
    },
  ]);
});

test("buffers child events until attribution arrives then flushes to parent eco thread", () => {
  const attributions = new Map<string, { parentThreadId: string; agentRole?: string }>();
  const events: Array<{ threadId: string; eventType: string; agentId?: string }> = [];
  const adapter = new CodexEventAdapter({
    resolveEcoThreadId: (codexThreadId) => (codexThreadId === CODEX_THREAD ? ECO_THREAD : codexThreadId),
    resolveThreadAttribution: (codexThreadId) => {
      const record = attributions.get(codexThreadId);
      if (!record?.parentThreadId) {
        return undefined;
      }
      return {
        ecoThreadId: ECO_THREAD,
        billingRole: "explore",
        parentEcoThreadId: ECO_THREAD,
        isSubagentThread: true,
        agentId: codexThreadId,
      };
    },
    recordThreadAttribution: (codexThreadId, record) => {
      attributions.set(codexThreadId, record);
      adapter.flushPendingEventsForThread(codexThreadId);
    },
    recordThreadRunEvent: (event) => {
      events.push({
        threadId: event.threadId,
        eventType: event.eventType,
        ...(event.agentId && { agentId: event.agentId }),
      });
    },
  });

  // Child turn starts before spawn attribution (live race).
  adapter.dispatch("turn/started", {
    threadId: "thr_codex_child_race",
    turn: { id: "turn_child_race", status: "inProgress" },
  });
  expect(events).toHaveLength(0);

  adapter.dispatch("thread/started", {
    thread: {
      id: "thr_codex_child_race",
      parentThreadId: CODEX_THREAD,
      agentRole: "explore",
    },
  });

  expect(events.map((event) => event.eventType)).toEqual(["run.attempt.started", "agent.started"]);
  expect(events[0]).toMatchObject({
    threadId: ECO_THREAD,
    eventType: "run.attempt.started",
    agentId: "thr_codex_child_race",
  });
  expect(events[1]).toMatchObject({
    threadId: ECO_THREAD,
    eventType: "agent.started",
    agentId: "thr_codex_child_race",
  });
});

test("child thread events resolve to parent eco thread via attribution", () => {
  const attributions = new Map<
    string,
    { parentThreadId: string; agentRole?: string; spawnCallId?: string }
  >();
  const events: Array<{
    threadId: string;
    eventType: string;
    agentId?: string;
    scope: string;
    role?: string;
  }> = [];
  const adapter = new CodexEventAdapter({
    resolveEcoThreadId: (codexThreadId) => (codexThreadId === CODEX_THREAD ? ECO_THREAD : codexThreadId),
    resolveThreadAttribution: (codexThreadId) => {
      const record = attributions.get(codexThreadId);
      if (!record?.parentThreadId) {
        return undefined;
      }
      return {
        ecoThreadId: ECO_THREAD,
        billingRole: (record.agentRole?.trim() || "subagent") as "subagent",
        parentEcoThreadId: ECO_THREAD,
        isSubagentThread: true,
        agentId: codexThreadId,
      };
    },
    recordThreadAttribution: (codexThreadId, record) => {
      attributions.set(codexThreadId, record);
    },
    recordThreadRunEvent: (event) => {
      events.push({
        threadId: event.threadId,
        eventType: event.eventType,
        scope: event.scope,
        ...(event.agentId && { agentId: event.agentId }),
        ...(event.role && { role: event.role }),
      });
    },
  });

  adapter.dispatch("item/started", {
    threadId: CODEX_THREAD,
    turnId: "turn_spawn_parent",
    item: {
      type: "collabAgentToolCall",
      id: "item_spawn_parent",
      tool: "spawnAgent",
      status: "inProgress",
      senderThreadId: CODEX_THREAD,
      receiverThreadIds: ["thr_codex_child_live"],
    },
  });
  adapter.dispatch("turn/started", {
    threadId: "thr_codex_child_live",
    turn: { id: "turn_child_live", status: "inProgress" },
  });
  adapter.dispatch("item/reasoning/textDelta", {
    threadId: "thr_codex_child_live",
    turnId: "turn_child_live",
    itemId: "item_child_think",
    delta: "looking",
  });

  const childEvents = events.filter((event) => event.agentId === "thr_codex_child_live");
  expect(childEvents.length).toBeGreaterThanOrEqual(2);
  expect(childEvents.every((event) => event.threadId === ECO_THREAD)).toBe(true);
  expect(childEvents.every((event) => event.scope === "agent")).toBe(true);
  expect(childEvents.some((event) => event.eventType === "run.attempt.started")).toBe(true);
  expect(childEvents.some((event) => event.eventType === "thinking.delta")).toBe(true);
});

test("dispatch records thread attribution on spawn item/started and thread/started", () => {
  const attributions: Array<{ codexThreadId: string; record: Record<string, unknown> }> = [];
  const adapter = new CodexEventAdapter({
    resolveEcoThreadId,
    recordThreadRunEvent: () => {},
    recordThreadAttribution: (codexThreadId, record) => {
      attributions.push({ codexThreadId, record });
    },
    dequeueSpawnPayloadMatching: ({ toolUseId }) =>
      toolUseId === "item_spawn_001" ? { agentRole: "explore", toolUseId } : undefined,
  });

  adapter.dispatch("item/started", {
    threadId: CODEX_THREAD,
    turnId: "turn_spawn_001",
    item: {
      type: "collabAgentToolCall",
      id: "item_spawn_001",
      tool: "spawnAgent",
      status: "inProgress",
      senderThreadId: CODEX_THREAD,
      receiverThreadIds: ["thr_codex_child_001"],
    },
  });
  adapter.dispatch("thread/started", {
    thread: {
      id: "thr_codex_child_001",
      parentThreadId: CODEX_THREAD,
      agentRole: "explore",
      agentNickname: "scout-1",
    },
  });

  expect(attributions).toHaveLength(2);
  expect(attributions[0]).toEqual({
    codexThreadId: "thr_codex_child_001",
    record: {
      parentThreadId: CODEX_THREAD,
      agentRole: "explore",
      spawnCallId: "item_spawn_001",
    },
  });
  expect(attributions[1]).toEqual({
    codexThreadId: "thr_codex_child_001",
    record: {
      parentThreadId: CODEX_THREAD,
      agentRole: "explore",
      agentNickname: "scout-1",
    },
  });
});

test("spawn-turn.jsonl fixture replays to expected agent lifecycle sequence", () => {
  const fixturePath = path.resolve(
    import.meta.dir,
    "../../../docs/fixtures/codex-item-stream/spawn-turn.jsonl",
  );
  const fixture = fs.readFileSync(fixturePath, "utf8");
  const events = replayCodexNotificationFixture(fixture, {
    resolveEcoThreadId: (codexThreadId) =>
      codexThreadId === "thr_codex_parent_001" ? ECO_THREAD : codexThreadId,
    recordThreadRunEvent: () => {},
    dequeueSpawnPayloadMatching: ({ toolUseId }) =>
      toolUseId === "item_spawn_001" ? { agentRole: "explore", toolUseId } : undefined,
    now: () => "2026-07-03T12:00:00.000Z",
  });

  // The spawn RPC only confirms child creation. Child turn/completed owns the terminal lifecycle.
  expect(events.map((event) => event.eventType)).toEqual([
    "run.attempt.started",
    "agent.started",
    "run.attempt.completed",
  ]);

  const started = events.find((event) => event.eventType === "agent.started");
  expect(started?.threadId).toBe(ECO_THREAD);
  expect(started?.role).toBe("explore");
  expect(started?.agentId).toBe("thr_codex_child_explore_001");
  expect(started?.parentToolUseId).toBe("item_spawn_001");
  expect(started?.metadata?.delegationPrompt).toBe("Explore the auth module and list key entry points.");
  expect(started?.metadata?.delegationSummary).toBeTruthy();
});

test("dispatch maps commandExecution lifecycle to tool.started and tool.completed", () => {
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({ resolveEcoThreadId, recordThreadRunEvent: record });
    adapter.dispatch("item/started", {
      threadId: CODEX_THREAD,
      turnId: "turn_bash_001",
      item: {
        type: "commandExecution",
        id: "item_bash_001",
        command: "git status",
        cwd: "/repo",
        commandActions: [{ type: "listFiles", command: "git status", path: "/repo" }],
        status: "inProgress",
      },
    });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_bash_001",
      item: {
        type: "commandExecution",
        id: "item_bash_001",
        command: "git status",
        commandActions: [{ type: "listFiles", command: "git status", path: "/repo" }],
        status: "completed",
        aggregatedOutput: "clean\n",
        exitCode: 0,
        durationMs: 12,
      },
    });
  });

  expect(events.map((event) => event.eventType)).toEqual(["tool.started", "tool.completed"]);
  expect(events.every((event) => event.streamKey === "item_bash_001")).toBe(true);
  expect(events[0]?.metadata?.tool).toMatchObject({
    name: "Bash",
    detail: "git status",
    description: "列出文件 · /repo",
    toolUseId: "item_bash_001",
    status: "started",
  });
  expect(events[1]?.metadata?.tool).toMatchObject({
    name: "Bash",
    detail: "git status",
    description: "列出文件 · /repo",
    toolUseId: "item_bash_001",
    status: "completed",
    output: "clean\n",
    exitCode: 0,
    durationMs: 12,
  });
});

test("dispatch maps plan item completed to thread.status plan.ready", () => {
  const planReady = mock();
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      onPlanReady: planReady,
    });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_plan_001",
      item: {
        type: "plan",
        id: "item_plan_001",
        text: "## Plan\n\nShip it.",
        planFilePath: ".codex/plan.md",
      },
    });
  });

  expect(events).toHaveLength(1);
  expect(events[0]?.eventType).toBe("thread.status");
  expect(events[0]?.role).toBe("planner");
  expect(events[0]?.message).toBe("计划已生成，等待确认。");
  expect(events[0]?.metadata?.liveType).toBe("plan.ready");
  expect(events[0]?.metadata?.plan).toEqual({
    plan: "## Plan\n\nShip it.",
    planFilePath: ".codex/plan.md",
  });
  expect(planReady).toHaveBeenCalledWith({
    ecoThreadId: ECO_THREAD,
    codexThreadId: CODEX_THREAD,
    turnId: "turn_plan_001",
    itemId: "item_plan_001",
    plan: "## Plan\n\nShip it.",
    planFilePath: ".codex/plan.md",
  });
});

test("dispatch maps contextCompaction item lifecycle with Codex correlation metadata", () => {
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({ resolveEcoThreadId, recordThreadRunEvent: record });
    adapter.dispatch("item/started", {
      threadId: CODEX_THREAD,
      turnId: "turn_compact_001",
      item: { type: "contextCompaction", id: "item_compact_001" },
      startedAtMs: 1_788_000_000_000,
    });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_compact_001",
      item: { type: "contextCompaction", id: "item_compact_001" },
      completedAtMs: 1_788_000_000_100,
    });
  });

  expect(events.map((event) => event.eventType)).toEqual([
    "context.compaction.started",
    "context.compaction.completed",
  ]);
  expect(events.map((event) => event.streamState)).toEqual(["none", "finalized"]);
  expect(events.map((event) => event.message)).toEqual(["正在压缩上下文", "上下文已压缩"]);
  expect(events.every((event) => event.threadId === ECO_THREAD)).toBe(true);
  expect(events.every((event) => event.runAttemptId === undefined)).toBe(true);
  expect(events.every((event) => event.metadata?.turnId === "turn_compact_001")).toBe(true);
  expect(events.every((event) => event.streamKey === "item_compact_001")).toBe(true);
  expect(events.map((event) => event.metadata)).toEqual([
    {
      codexMethod: "item/started",
      codexThreadId: CODEX_THREAD,
      logicalEntityId: "item_compact_001",
      itemId: "item_compact_001",
      itemType: "contextCompaction",
      turnId: "turn_compact_001",
    },
    {
      codexMethod: "item/completed",
      codexThreadId: CODEX_THREAD,
      logicalEntityId: "item_compact_001",
      itemId: "item_compact_001",
      itemType: "contextCompaction",
      turnId: "turn_compact_001",
    },
  ]);
});

test("dispatch ignores malformed contextCompaction items without lifecycle ids", () => {
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({ resolveEcoThreadId, recordThreadRunEvent: record });
    adapter.dispatch("item/started", {
      threadId: CODEX_THREAD,
      turnId: "turn_compact_001",
      item: { type: "contextCompaction" },
    });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      item: { type: "contextCompaction", id: "item_compact_001" },
    });
  });

  expect(events).toEqual([]);
});

test("dispatch suppresses contextCompaction already owned by an outer scheduler", () => {
  const events = collectEvents((record) => {
    const adapter = new CodexEventAdapter({
      resolveEcoThreadId,
      recordThreadRunEvent: record,
      shouldRecordContextCompaction: (codexThreadId) => codexThreadId !== CODEX_THREAD,
    });
    adapter.dispatch("item/started", {
      threadId: CODEX_THREAD,
      turnId: "turn_compact_001",
      item: { type: "contextCompaction", id: "item_compact_001" },
    });
    adapter.dispatch("item/completed", {
      threadId: CODEX_THREAD,
      turnId: "turn_compact_001",
      item: { type: "contextCompaction", id: "item_compact_001" },
    });
  });

  expect(events).toEqual([]);
});

test("dispatch invokes onTokenUsageUpdated for thread/tokenUsage/updated", () => {
  let contextUpdate: unknown;
  const adapter = new CodexEventAdapter({
    resolveEcoThreadId,
    recordThreadRunEvent: () => {},
    onTokenUsageUpdated: (resolution) => {
      contextUpdate = resolution;
    },
  });
  adapter.dispatch("thread/tokenUsage/updated", {
    threadId: CODEX_THREAD,
    turnId: "turn_001",
    tokenUsage: {
      last: {
        cachedInputTokens: 0,
        inputTokens: 10_000,
        outputTokens: 500,
        reasoningOutputTokens: 0,
        totalTokens: 42_000,
      },
      total: {
        cachedInputTokens: 0,
        inputTokens: 10_000,
        outputTokens: 500,
        reasoningOutputTokens: 0,
        totalTokens: 42_000,
      },
      modelContextWindow: 200_000,
    },
  });

  expect(contextUpdate).toBeDefined();
  const resolved = contextUpdate as {
    ecoThreadId: string;
    contextOccupied: number;
    context: { segments: unknown[] };
  };
  expect(resolved.ecoThreadId).toBe(ECO_THREAD);
  expect(resolved.contextOccupied).toBe(42_000);
  expect(resolved.context.segments).toEqual([]);
});
