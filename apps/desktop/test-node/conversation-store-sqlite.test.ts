import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createAgentOrchestrationStore } from "../src/main/agent-orchestration-store";
import { createConversationStore } from "../src/main/conversation-store";
import { createProjectMcpSettingsStore } from "../src/main/project-mcp-settings-store";
import { createProjectSkillsSettingsStore } from "../src/main/project-skills-settings-store";
import type { ThreadSummary } from "../src/shared/ipc";

async function createTestDirectory(t: test.TestContext, prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("Node SQLite remembers Skills independently for each project", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-project-skills-");
  const store = await createProjectSkillsSettingsStore(path.join(directory, "eco-coding.sqlite"));
  const projectA = path.join(directory, "a");
  const projectB = path.join(directory, "b");

  store.save({ workspacePath: projectA, enabledByPath: { "user:a": true } });
  store.save({ workspacePath: projectB, enabledByPath: { "user:a": false } });

  assert.deepEqual(store.get(projectA).enabledByPath, { "user:a": true });
  assert.deepEqual(store.get(projectB).enabledByPath, { "user:a": false });
});

test("Node SQLite remembers MCP switches independently for each project", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-project-mcp-");
  const store = await createProjectMcpSettingsStore(path.join(directory, "eco-coding.sqlite"));
  const projectA = path.join(directory, "a");
  const projectB = path.join(directory, "b");

  store.save({ workspacePath: projectA, enabledByServer: { github: true, browser: false } });
  store.save({ workspacePath: projectB, enabledByServer: { github: false, browser: true } });

  assert.deepEqual(store.get(projectA).enabledByServer, { github: true, browser: false });
  assert.deepEqual(store.get(projectB).enabledByServer, { github: false, browser: true });
});

test("Node SQLite stores independent orchestration resources and guards default references", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-orchestration-store-");
  const databasePath = path.join(directory, "eco-coding.sqlite");
  const store = await createAgentOrchestrationStore(databasePath);
  const updatedAt = "2026-01-01T00:00:00.000Z";

  store.saveMainAgentConfig({
    id: "main_1",
    name: "Main",
    agentKey: "main",
    modelRef: { providerId: "provider_1", modelId: "model_1" },
    tools: { allowed: [], disallowed: [] },
    skills: [],
    source: "user",
    updatedAt,
  });
  store.saveMainAgentPrompt({
    id: "prompt_1",
    name: "Prompt",
    mode: "custom_append",
    prompt: "Follow the project conventions.",
    source: "user",
    updatedAt,
  });
  store.saveSubagentOrchestration({
    id: "subagents_1",
    name: "Subagents",
    strategy: { kind: "autonomous" },
    agents: [],
    source: "user",
    updatedAt,
  });

  const selection = {
    mainAgentConfigId: "main_1",
    mainPrompt: { mode: "custom_append" as const, promptId: "prompt_1" },
    subagents: { mode: "orchestration" as const, orchestrationId: "subagents_1" },
  };
  assert.equal(store.listMainAgentConfigs().length, 1);
  assert.equal(store.listMainAgentPrompts().length, 1);
  assert.equal(store.listSubagentOrchestrations().length, 1);
  assert.throws(() => store.deleteMainAgentConfig("main_1", selection), /默认编排组合引用/);
  assert.throws(() => store.deleteMainAgentPrompt("prompt_1", selection), /默认编排组合引用/);
  // Subagent orchestrations are not guarded by remembered default selection.
  assert.doesNotThrow(() => store.deleteSubagentOrchestration("subagents_1"));
  store.saveSubagentOrchestration({
    id: "subagents_1",
    name: "Subagents",
    strategy: { kind: "autonomous" },
    agents: [],
    source: "user",
    updatedAt,
  });

  store.deleteMainAgentConfig("main_1");
  store.deleteMainAgentPrompt("prompt_1");
  store.deleteSubagentOrchestration("subagents_1");
  assert.deepEqual(store.listMainAgentConfigs(), []);
  assert.deepEqual(store.listMainAgentPrompts(), []);
  assert.deepEqual(store.listSubagentOrchestrations(), []);

  const inspection = new DatabaseSync(databasePath);
  t.after(() => inspection.close());
  const tables = inspection
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
  assert.deepEqual(tables, [
    "agent_templates",
    "main_agent_configs",
    "main_agent_prompts",
    "subagent_orchestrations",
  ]);
});

test("Node SQLite persists an Eco thread and Claude session binding", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-sqlite-store-");
  const databasePath = path.join(directory, "eco-coding.sqlite");
  const store = await createConversationStore(databasePath);
  const now = new Date().toISOString();
  const thread: ThreadSummary = {
    id: "thr_node_sqlite",
    title: "Node SQLite",
    prompt: "verify persistence",
    workspacePath: "/tmp/eco-node-sqlite",
    status: "idle",
    message: "ready",
    createdAt: now,
    updatedAt: now,
  };

  store.saveThread(thread);
  store.saveSdkSession(thread.id, "sdk_session_node", thread.workspacePath);

  assert.deepEqual(store.getSdkSession(thread.id), {
    sessionId: "sdk_session_node",
    cwd: thread.workspacePath,
  });
  assert.equal(store.getThread(thread.id)?.title, thread.title);
  assert.equal(store.getThread(thread.id)?.coreKind, "claude");
  assert.equal(store.getThread(thread.id)?.externalSessionId, "sdk_session_node");
  assert.ok(store.getThread(thread.id)?.coreLockedAt);
  assert.deepEqual(
    {
      coreKind: store.getThreadCoreSession(thread.id)?.coreKind,
      externalSessionId: store.getThreadCoreSession(thread.id)?.externalSessionId,
      cwd: store.getThreadCoreSession(thread.id)?.cwd,
    },
    {
      coreKind: "claude",
      externalSessionId: "sdk_session_node",
      cwd: thread.workspacePath,
    },
  );

  const inspection = new DatabaseSync(databasePath);
  const row = inspection
    .prepare("SELECT title, core_kind, core_locked_at, sdk_session_id, sdk_cwd FROM threads WHERE id = ?")
    .get(thread.id) as
    | {
        title: string;
        core_kind: string;
        core_locked_at: string;
        sdk_session_id: string;
        sdk_cwd: string;
      }
    | undefined;
  assert.equal(row?.title, thread.title);
  assert.equal(row?.core_kind, "claude");
  assert.ok(row?.core_locked_at);
  assert.equal(row?.sdk_session_id, "sdk_session_node");
  assert.equal(row?.sdk_cwd, thread.workspacePath);
  inspection.close();
});

test("Node SQLite atomically claims and reconciles streaming follow-ups", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-streaming-follow-up-");
  const databasePath = path.join(directory, "eco-coding.sqlite");
  const store = await createConversationStore(databasePath);
  const threadId = "thr_streaming_follow_up";
  store.saveThread({
    id: threadId,
    title: "Streaming follow-up",
    prompt: "verify delivery state",
    workspacePath: "/tmp/eco-streaming-follow-up",
    status: "running",
    message: "running",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const accepted = store.enqueueThreadFollowUp({ threadId, prompt: "accepted" });
  const claimed = store.claimThreadFollowUpStreamingPush(threadId, accepted.id, {
    targetRunAttemptId: "attempt_push",
  });
  assert.equal(claimed?.status, "delivered");
  assert.equal(claimed?.deliveryMode, "streaming_push");
  assert.equal(claimed?.appliedAt, undefined);
  assert.equal(store.cancelThreadFollowUp(threadId, accepted.id), undefined);
  assert.equal(
    store.updateThreadFollowUp(threadId, accepted.id, { prompt: "must not replace sent text" }),
    undefined,
  );
  assert.equal(store.markThreadFollowUpStreamingPushApplied(threadId, accepted.id)?.status, "applied");

  const rejected = store.enqueueThreadFollowUp({
    threadId,
    prompt: "explicitly rejected",
    priority: "escalated",
  });
  store.claimThreadFollowUpStreamingPush(threadId, rejected.id);
  const requeued = store.requeueThreadFollowUpStreamingPush(threadId, rejected.id, {
    error: "no active turn",
  });
  assert.equal(requeued?.status, "queued");
  assert.equal(requeued?.deliveryMode, "interrupt_resume");
  assert.equal(requeued?.deliveredAt, undefined);

  const uncertain = store.enqueueThreadFollowUp({ threadId, prompt: "uncertain" });
  store.claimThreadFollowUpStreamingPush(threadId, uncertain.id);
  const failed = store.markThreadFollowUpDeliveryUnknown(
    threadId,
    uncertain.id,
    "transport closed after send",
  );
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.deliveryMode, "streaming_push");
  assert.equal(
    store.claimQueuedThreadFollowUps(threadId).some((item) => item.id === uncertain.id),
    false,
  );

  const orphaned = store.enqueueThreadFollowUp({ threadId, prompt: "crashed in flight" });
  store.claimThreadFollowUpStreamingPush(threadId, orphaned.id);
  const reopened = await createConversationStore(databasePath);
  const recovered = reopened
    .listThreadFollowUps(threadId, { statuses: ["delivered"] })
    .find((followUp) => followUp.id === orphaned.id);
  assert.equal(recovered?.deliveryMode, "streaming_push");
  assert.equal(
    reopened.markThreadFollowUpDeliveryUnknown(threadId, orphaned.id, "application exited during push")
      ?.status,
    "failed",
  );
});

test("Node SQLite updates Codex cumulative stream events in place", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-codex-stream-");
  const store = await createConversationStore(path.join(directory, "eco-coding.sqlite"));
  const threadId = "thr_node_codex_stream";
  store.saveThread({
    id: threadId,
    title: "Codex stream",
    prompt: "verify cumulative output",
    workspacePath: "/tmp/eco-node-codex-stream",
    status: "running",
    message: "running",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const id = "tre:codex:message.delta:codex-thread:turn:item";
  const baseEvent = {
    id,
    threadId,
    eventType: "message.delta" as const,
    scope: "main" as const,
    role: "assistant",
    requestId: "codex-turn",
    streamKey: "msg_codex",
    streamState: "streaming" as const,
  };
  const first = store.appendThreadRunEvent({
    ...baseEvent,
    message: "对，",
    observedAt: "2026-01-01T00:00:01.000Z",
  });
  const updated = store.appendThreadRunEvent({
    ...baseEvent,
    message: "对，这是完整的累计流文本。",
    observedAt: "2026-01-01T00:00:02.000Z",
  });

  const events = store.listThreadRunEvents(threadId);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.message, "对，这是完整的累计流文本。");
  assert.ok(updated.sequence > first.sequence);
});

test("Node SQLite projects tool metadata and migrates legacy output exactly once", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-tool-output-projection-");
  const databasePath = path.join(directory, "eco-coding.sqlite");
  const threadId = "thr_tool_output_projection";
  const store = await createConversationStore(databasePath);
  store.saveThread({
    id: threadId,
    title: "Tool output projection",
    prompt: "verify migration",
    workspacePath: "/tmp/tool-output-projection",
    status: "idle",
    message: "ready",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const projectedRead = store.appendThreadRunEvent({
    id: "projected_read",
    threadId,
    eventType: "tool.completed",
    scope: "main",
    streamState: "finalized",
    message: "Tool: Read",
    observedAt: "2026-01-01T00:00:01.000Z",
    metadata: {
      tool: {
        name: "Read",
        toolUseId: "read_1",
        output: "secret contents",
        outputPreview: "secret preview",
        outputPreviewTruncated: true,
      },
    },
  });
  assert.deepEqual(projectedRead.metadata?.tool, { name: "Read", toolUseId: "read_1" });

  const projectedBash = store.appendThreadRunEvent({
    id: "projected_bash",
    threadId,
    eventType: "tool.completed",
    scope: "main",
    streamState: "finalized",
    message: "Tool: Bash",
    observedAt: "2026-01-01T00:00:02.000Z",
    metadata: {
      tool: {
        name: "Bash",
        detail: "bun test",
        output: "raw field must not persist",
        outputPreview: `head\n${"x".repeat(20_000)}\ntail`,
        exitCode: 0,
      },
    },
  });
  const projectedBashTool = projectedBash.metadata?.tool as Record<string, unknown>;
  assert.equal("output" in projectedBashTool, false);
  assert.equal(projectedBashTool.outputPreviewTruncated, true);
  assert.ok(String(projectedBashTool.outputPreview).startsWith("head\n"));
  assert.ok(String(projectedBashTool.outputPreview).endsWith("\ntail"));
  assert.ok(String(projectedBashTool.outputPreview).length <= 8_000);

  (store as unknown as { db: DatabaseSync }).db.close();
  const legacyDb = new DatabaseSync(databasePath);
  const insertLegacy = legacyDb.prepare(`
    INSERT INTO thread_run_events (
      id, thread_id, sequence, event_type, scope, stream_state, message, metadata_json, observed_at
    ) VALUES (?, ?, ?, ?, 'main', 'finalized', ?, ?, ?)
  `);
  insertLegacy.run(
    "legacy_bash",
    threadId,
    3,
    "tool.completed",
    "Tool: Bash",
    JSON.stringify({
      tool: {
        name: "Bash",
        output: `${"a".repeat(10_000)}\n\n…（输出已截断，完整内容未写入上下文；详见运行日志提示）`,
        outputTruncated: true,
        outputOriginalChars: 10_000,
        outputKeptChars: 8_000,
      },
    }),
    "2026-01-01T00:00:03.000Z",
  );
  insertLegacy.run(
    "legacy_search",
    threadId,
    4,
    "tool.completed",
    "Tool: Grep",
    JSON.stringify({
      tool: {
        name: "Grep",
        detail: "needle",
        output: "matching source text",
        outputPreview: "matching source preview",
      },
    }),
    "2026-01-01T00:00:04.000Z",
  );
  insertLegacy.run(
    "legacy_notice",
    threadId,
    5,
    "context.tool_output_truncated",
    "Read output truncated",
    JSON.stringify({ liveType: "context.tool_output_truncated" }),
    "2026-01-01T00:00:05.000Z",
  );
  insertLegacy.run(
    "legacy_invalid",
    threadId,
    6,
    "tool.completed",
    "Tool: Read",
    "{bad json",
    "2026-01-01T00:00:06.000Z",
  );
  legacyDb
    .prepare("DELETE FROM conversation_store_migrations WHERE id = ?")
    .run("thread-run-tool-output-projection-v1");
  legacyDb.close();

  const originalStderrWrite = process.stderr.write;
  let migrationWarning = "";
  process.stderr.write = ((chunk: string | Uint8Array) => {
    migrationWarning += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  let migrated: Awaited<ReturnType<typeof createConversationStore>>;
  try {
    migrated = await createConversationStore(databasePath);
  } finally {
    process.stderr.write = originalStderrWrite;
  }
  assert.match(migrationWarning, /count=1/);
  assert.match(migrationWarning, /eventIds=legacy_invalid/);

  const migratedEvents = migrated.listThreadRunEvents(threadId);
  assert.equal(
    migratedEvents.some((event) => event.id === "legacy_notice"),
    false,
  );
  const legacyBash = migratedEvents.find((event) => event.id === "legacy_bash");
  const legacyBashTool = legacyBash?.metadata?.tool as Record<string, unknown>;
  assert.equal("output" in legacyBashTool, false);
  assert.equal("outputOriginalChars" in legacyBashTool, false);
  assert.equal(legacyBashTool.outputPreviewTruncated, true);
  assert.ok(!String(legacyBashTool.outputPreview).includes("完整内容未写入上下文"));
  assert.ok(String(legacyBashTool.outputPreview).length <= 8_000);
  assert.deepEqual(migratedEvents.find((event) => event.id === "legacy_search")?.metadata?.tool, {
    name: "Grep",
    detail: "needle",
  });

  (migrated as unknown as { db: DatabaseSync }).db.close();
  const inspection = new DatabaseSync(databasePath);
  assert.equal(
    (
      inspection
        .prepare("SELECT COUNT(*) AS count FROM thread_run_events WHERE event_type = ?")
        .get("context.tool_output_truncated") as { count: number }
    ).count,
    0,
  );
  assert.equal(
    (
      inspection
        .prepare("SELECT COUNT(*) AS count FROM conversation_store_migrations WHERE id = ?")
        .get("thread-run-tool-output-projection-v1") as { count: number }
    ).count,
    1,
  );
  const storedMetadata = inspection
    .prepare("SELECT id, metadata_json FROM thread_run_events WHERE metadata_json IS NOT NULL")
    .all() as Array<{ id: string; metadata_json: string }>;
  for (const row of storedMetadata) {
    if (row.id === "legacy_invalid") continue;
    const metadata = JSON.parse(row.metadata_json) as { tool?: Record<string, unknown> };
    assert.equal(metadata.tool && "output" in metadata.tool, false, row.id);
    if (metadata.tool?.name !== "Bash") {
      assert.equal(metadata.tool && "outputPreview" in metadata.tool, false, row.id);
      assert.equal(metadata.tool && "outputPreviewTruncated" in metadata.tool, false, row.id);
    }
  }
  inspection.close();

  const reopened = await createConversationStore(databasePath);
  assert.equal(
    reopened.listThreadRunEvents(threadId).some((event) => event.id === "legacy_notice"),
    false,
  );
  (reopened as unknown as { db: DatabaseSync }).db.close();
});

test("Node SQLite incrementally maintains bounded projection reads in WAL mode", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-projection-cache-");
  const databasePath = path.join(directory, "eco-coding.sqlite");
  const store = await createConversationStore(databasePath);
  const threadId = "thr_projection_cache";
  const streamId = "tre:stream:thr_projection_cache:message.delta:stream_1";
  store.saveThread({
    id: threadId,
    title: "Projection cache",
    prompt: "stream",
    workspacePath: "/tmp/projection-cache",
    status: "running",
    message: "working",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const appendStream = (id: string, message: string, observedAt: string) =>
    store.appendThreadRunEvent({
      id,
      threadId,
      eventType: "message.delta",
      scope: "agent",
      role: "coder",
      agentId: "agent_coder_a",
      runAttemptId: "attempt_1",
      requestId: "request_1",
      streamKey: "stream_1",
      streamState: "streaming",
      message,
      observedAt,
    });

  const initialStream = appendStream(streamId, "一", "2026-01-01T00:00:01.000Z");
  store.appendThreadRunEvent({
    id: "final_before_cache",
    threadId,
    eventType: "message.final",
    scope: "agent",
    role: "coder",
    agentId: "agent_coder_a",
    streamState: "finalized",
    message: "第一轮完成",
    observedAt: "2026-01-01T00:00:02.000Z",
  });

  const first = store.listThreadRunEventsForProjection(threadId, 10);
  assert.strictEqual(store.listThreadRunEventsForProjection(threadId, 10), first);

  const updatedStream = appendStream(streamId, "一段增量文字", "2026-01-01T00:00:03.000Z");
  assert.ok(updatedStream.sequence > initialStream.sequence);
  const afterStableUpdate = store.listThreadRunEventsForProjection(threadId, 10);
  assert.notStrictEqual(afterStableUpdate, first);
  assert.equal(afterStableUpdate.find((event) => event.id === streamId)?.message, "一段增量文字");

  appendStream("legacy_stream_replacement", "旧格式的新累计行", "2026-01-01T00:00:04.000Z");
  assert.deepEqual(
    store.listThreadRunEventsForProjection(threadId, 10).map((event) => event.id),
    ["final_before_cache", "legacy_stream_replacement"],
  );
  assert.equal(store.compactLegacyThreadRunStreamEvents(), 1);
  assert.deepEqual(
    store.listThreadRunEvents(threadId).map((event) => event.id),
    ["final_before_cache", "legacy_stream_replacement"],
  );

  const inspection = new DatabaseSync(databasePath, { readOnly: true });
  const journal = inspection.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
  assert.equal(journal.journal_mode, "wal");
  inspection.close();

  store.clearThreadRunEvents(threadId);
  assert.equal(appendStream("after_clear", "重新开始", "2026-01-01T00:00:05.000Z").sequence, 1);
  assert.deepEqual(
    store.listThreadRunEventsForProjection(threadId, 10).map((event) => event.id),
    ["after_clear"],
  );
});

test("Node SQLite persists composer drafts and clears deleted thread drafts", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-composer-draft-");
  const databasePath = path.join(directory, "eco-coding.sqlite");
  const store = await createConversationStore(databasePath);

  store.saveComposerDraft("landing:/tmp/project", "draft on landing");
  const reloaded = await createConversationStore(databasePath);
  assert.equal(reloaded.getComposerDraft("landing:/tmp/project")?.prompt, "draft on landing");

  const now = new Date().toISOString();
  reloaded.saveThread({
    id: "thr_composer_draft",
    title: "Composer draft",
    prompt: "initial",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "ready",
    createdAt: now,
    updatedAt: now,
  });
  reloaded.saveComposerDraft("thread:thr_composer_draft", "thread draft");
  assert.equal(reloaded.getComposerDraft("thread:thr_composer_draft")?.prompt, "thread draft");

  reloaded.deleteThread("thr_composer_draft");
  assert.equal(reloaded.getComposerDraft("thread:thr_composer_draft"), undefined);

  reloaded.saveComposerDraft("landing:/tmp/project", "");
  assert.equal(reloaded.getComposerDraft("landing:/tmp/project"), undefined);
});

test("Node SQLite persists reordered follow-ups", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-follow-up-reorder-");
  const store = await createConversationStore(path.join(directory, "eco-coding.sqlite"));
  const now = new Date().toISOString();
  store.saveThread({
    id: "thr_followup_reorder",
    title: "Follow-up reorder",
    prompt: "start",
    workspacePath: "/tmp/follow-up-reorder",
    status: "running",
    message: "working",
    createdAt: now,
    updatedAt: now,
  });
  const first = store.enqueueThreadFollowUp({ threadId: "thr_followup_reorder", prompt: "第一条" });
  const second = store.enqueueThreadFollowUp({ threadId: "thr_followup_reorder", prompt: "第二条" });

  const reordered = store.reorderQueuedThreadFollowUps("thr_followup_reorder", [second.id, first.id]);

  assert.deepEqual(
    reordered.map((item) => item.id),
    [second.id, first.id],
  );
  assert.deepEqual(
    store.listThreadFollowUps("thr_followup_reorder", { statuses: ["queued"] }).map((item) => item.id),
    [second.id, first.id],
  );
});

test("Node SQLite claims queued follow-ups one at a time by default", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-follow-up-queue-");
  const store = await createConversationStore(path.join(directory, "eco-coding.sqlite"));
  const now = new Date().toISOString();
  store.saveThread({
    id: "thr_followup_queue",
    title: "Follow-up queue",
    prompt: "start",
    workspacePath: "/tmp/follow-up-queue",
    status: "running",
    message: "working",
    createdAt: now,
    updatedAt: now,
  });
  const first = store.enqueueThreadFollowUp({
    threadId: "thr_followup_queue",
    prompt: "第一条",
  });
  const second = store.enqueueThreadFollowUp({
    threadId: "thr_followup_queue",
    prompt: "第二条",
  });

  const claimed = store.claimQueuedThreadFollowUps("thr_followup_queue", {
    deliveryMode: "resume",
    deliveryBoundary: "safe_boundary",
  });

  assert.deepEqual(
    claimed.map((item) => item.id),
    [first.id],
  );
  assert.equal(store.getThreadFollowUp("thr_followup_queue", first.id)?.status, "delivered");
  assert.equal(store.getThreadFollowUp("thr_followup_queue", second.id)?.status, "queued");
});

test("Node SQLite migrates the legacy thread activity schema", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-sqlite-migration-");
  const databasePath = path.join(directory, "eco-coding.sqlite");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sdk_session_id TEXT,
      sdk_cwd TEXT
    );

    CREATE TABLE thread_activity (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      message TEXT NOT NULL,
      stream INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
    );
  `);
  legacy
    .prepare(
      `INSERT INTO threads (
         id, title, prompt, workspace_path, status, message, created_at, updated_at,
         sdk_session_id, sdk_cwd
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "thr_legacy_claude",
      "Legacy Claude",
      "legacy prompt",
      "/tmp/legacy-claude",
      "idle",
      "ready",
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "sdk_legacy",
      "/tmp/legacy-claude",
    );
  legacy.close();

  await createConversationStore(databasePath);

  const migrated = new DatabaseSync(databasePath);
  const columns = migrated.prepare("PRAGMA table_info(thread_activity)").all() as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === "sdk_user_message_id"));
  const indexes = migrated.prepare("PRAGMA index_list(thread_activity)").all() as Array<{ name: string }>;
  assert.ok(indexes.some((index) => index.name === "idx_thread_activity_thread_sdk_user_message"));
  const thread = migrated
    .prepare("SELECT core_kind, core_locked_at FROM threads WHERE id = 'thr_legacy_claude'")
    .get() as { core_kind: string; core_locked_at: string } | undefined;
  assert.equal(thread?.core_kind, "claude");
  assert.equal(thread?.core_locked_at, "2026-01-01T00:00:00.000Z");
  const binding = migrated
    .prepare(
      `SELECT core_kind, external_session_id, cwd
       FROM thread_core_sessions
       WHERE thread_id = 'thr_legacy_claude'`,
    )
    .get() as { core_kind: string; external_session_id: string; cwd: string } | undefined;
  assert.equal(binding?.core_kind, "claude");
  assert.equal(binding?.external_session_id, "sdk_legacy");
  assert.equal(binding?.cwd, "/tmp/legacy-claude");
  migrated.close();
});

test("Node SQLite rejects a Claude session binding for a Codex thread", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-sqlite-core-mismatch-");
  const databasePath = path.join(directory, "eco-coding.sqlite");
  const store = await createConversationStore(databasePath);
  const now = new Date().toISOString();
  store.saveThread({
    id: "thr_codex",
    title: "Codex",
    prompt: "codex prompt",
    workspacePath: "/tmp/codex",
    status: "idle",
    message: "ready",
    createdAt: now,
    updatedAt: now,
    coreKind: "codex",
    coreLockedAt: now,
  });

  assert.throws(
    () => store.saveSdkSession("thr_codex", "sdk_wrong_core", "/tmp/codex"),
    /Thread Core mismatch/,
  );
  assert.equal(store.getSdkSession("thr_codex"), undefined);
  assert.equal(store.getThreadCoreSession("thr_codex"), undefined);

  store.saveThreadCoreSession({
    threadId: "thr_codex",
    coreKind: "codex",
    externalSessionId: "codex_thread_1",
    cwd: "/tmp/codex",
    metadata: { schemaVersion: 1 },
  });
  assert.deepEqual(store.getThreadCoreSession("thr_codex")?.metadata, { schemaVersion: 1 });
  assert.equal(store.getThreadCoreSession("thr_codex")?.externalSessionId, "codex_thread_1");
  assert.equal(store.getThread("thr_codex")?.externalSessionId, "codex_thread_1");
});

test("Node SQLite leaves ambiguous mixed-product thread ownership unknown", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-sqlite-mixed-migration-");
  const databasePath = path.join(directory, "eco-coding.sqlite");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sdk_session_id TEXT,
      sdk_cwd TEXT
    );
    CREATE TABLE eco_thread_codex_map (
      eco_thread_id TEXT PRIMARY KEY,
      codex_thread_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const insertThread = legacy.prepare(
    `INSERT INTO threads (
       id, title, prompt, workspace_path, status, message, created_at, updated_at,
       sdk_session_id, sdk_cwd
     ) VALUES (?, ?, '', '/tmp/project', 'idle', 'ready', ?, ?, ?, ?)`,
  );
  const createdAt = "2026-02-01T00:00:00.000Z";
  insertThread.run("thr_only_codex", "Codex", createdAt, createdAt, null, null);
  insertThread.run("thr_only_claude", "Claude", createdAt, createdAt, "sdk_claude", "/tmp/project");
  insertThread.run("thr_conflict", "Conflict", createdAt, createdAt, "sdk_conflict", "/tmp/project");
  insertThread.run("thr_unknown", "Unknown", createdAt, createdAt, null, null);
  const insertMap = legacy.prepare(
    `INSERT INTO eco_thread_codex_map (eco_thread_id, codex_thread_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  );
  insertMap.run("thr_only_codex", "codex_only", createdAt, createdAt);
  insertMap.run("thr_conflict", "codex_conflict", createdAt, createdAt);
  legacy.close();

  const store = await createConversationStore(databasePath);

  assert.equal(store.getThread("thr_only_codex")?.coreKind, "codex");
  assert.equal(store.getThread("thr_only_claude")?.coreKind, "claude");
  assert.equal(store.getThread("thr_conflict")?.coreKind, undefined);
  assert.equal(store.getThread("thr_unknown")?.coreKind, undefined);
  assert.throws(
    () =>
      store.saveThreadCoreSession({
        threadId: "thr_conflict",
        coreKind: "codex",
        externalSessionId: "codex_conflict",
        cwd: "/tmp/project",
      }),
    /Thread Core mismatch/,
  );
});

test("Node SQLite keeps the unified Claude binding in sync across compaction", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-sqlite-compact-binding-");
  const databasePath = path.join(directory, "eco-coding.sqlite");
  const store = await createConversationStore(databasePath);
  const now = new Date().toISOString();
  store.saveThread({
    id: "thr_compact_binding",
    title: "Compact binding",
    prompt: "compact",
    workspacePath: "/tmp/compact-binding",
    status: "idle",
    message: "ready",
    createdAt: now,
    updatedAt: now,
    coreKind: "claude",
    coreLockedAt: now,
  });
  store.saveSdkSession("thr_compact_binding", "sdk_source", "/tmp/compact-binding");

  store.commitCompactHandoffAndClearSession("thr_compact_binding", {
    sourceSessionId: "sdk_source",
    sourceStartMessageId: "msg_start",
    sourceEndMessageId: "msg_end",
    summary: "summary",
    recentMessages: [{ role: "user", message: "recent" }],
    preTokensEstimate: 10_000,
    preTokensSource: "sdk_context_usage",
    postTokensEstimate: 2_000,
    postTokensSource: "local_heuristic",
    compressionRatio: 0.2,
  });
  assert.equal(store.getSdkSession("thr_compact_binding"), undefined);
  assert.equal(store.getThreadCoreSession("thr_compact_binding"), undefined);

  assert.equal(
    store.captureSdkSessionAndConsumeCompactHandoff(
      "thr_compact_binding",
      "sdk_target",
      "/tmp/compact-binding",
    ),
    true,
  );
  assert.equal(store.getSdkSession("thr_compact_binding")?.sessionId, "sdk_target");
  assert.equal(store.getThreadCoreSession("thr_compact_binding")?.externalSessionId, "sdk_target");
  assert.equal(store.getCompactHandoff("thr_compact_binding"), undefined);
});

test("Node SQLite binds projection-only Claude prompts to SDK messages", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-claude-projection-bind-");
  const store = await createConversationStore(path.join(directory, "eco-coding.sqlite"));
  const now = "2026-08-11T00:00:00.000Z";
  store.saveThread({
    id: "thr_claude_projection",
    title: "Claude projection",
    prompt: "first prompt",
    workspacePath: "/tmp/project",
    status: "completed",
    message: "ok",
    coreKind: "claude",
    coreLockedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  store.appendThreadRunEvent({
    id: "evt_claude_prompt",
    threadId: "thr_claude_projection",
    sequence: 1,
    eventType: "thread.status",
    scope: "main",
    role: "user",
    streamKey: "user:local-prompt",
    streamState: "none",
    message: "first prompt",
    observedAt: "2026-08-11T00:00:01.000Z",
    metadata: {
      liveType: "thread.user_prompt",
      rewindTarget: { activityLineId: "user:local-prompt" },
    },
  });
  store.saveUserMessageRecord({
    threadId: "thr_claude_projection",
    activityLineId: "user:local-prompt",
    text: "first prompt",
    provider: "claude",
  });

  assert.deepEqual(
    store.bindLatestUserActivityToSdkMessage("thr_claude_projection", "sdk-user-1")?.rewindTarget,
    { activityLineId: "user:local-prompt", userMessageId: "sdk-user-1" },
  );
  assert.equal(
    store.getUserMessageRecord("thr_claude_projection", "user:local-prompt")?.upstreamMessageId,
    "sdk-user-1",
  );
  assert.deepEqual(
    store.listFileCheckpoints("thr_claude_projection").map(({ userMessageId, activityLineId }) => ({
      userMessageId,
      activityLineId,
    })),
    [{ userMessageId: "sdk-user-1", activityLineId: "user:local-prompt" }],
  );
  assert.deepEqual(store.listThreadRunEvents("thr_claude_projection")[0]?.metadata?.rewindTarget, {
    activityLineId: "user:local-prompt",
    userMessageId: "sdk-user-1",
  });
});

test("Node SQLite rewinds projection-only Claude user activity lines", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-claude-projection-rewind-");
  const store = await createConversationStore(path.join(directory, "eco-coding.sqlite"));
  const now = "2026-08-11T00:00:00.000Z";
  store.saveThread({
    id: "thr_claude_proj_rewind",
    title: "Claude projection rewind",
    prompt: "first prompt",
    workspacePath: "/tmp/project",
    status: "completed",
    message: "ok",
    coreKind: "claude",
    coreLockedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  store.appendThreadRunEvent({
    id: "evt_prompt_a",
    threadId: "thr_claude_proj_rewind",
    sequence: 1,
    eventType: "thread.status",
    scope: "main",
    role: "user",
    streamKey: "user:local-a",
    streamState: "none",
    message: "first prompt",
    observedAt: "2026-08-11T00:00:01.000Z",
    metadata: {
      liveType: "thread.user_prompt",
      rewindTarget: { activityLineId: "user:local-a" },
    },
  });
  store.saveUserMessageRecord({
    threadId: "thr_claude_proj_rewind",
    activityLineId: "user:local-a",
    text: "first prompt",
    provider: "claude",
  });
  store.bindLatestUserActivityToSdkMessage("thr_claude_proj_rewind", "sdk-user-a");

  store.appendThreadRunEvent({
    id: "evt_prompt_b",
    threadId: "thr_claude_proj_rewind",
    sequence: 2,
    eventType: "thread.status",
    scope: "main",
    role: "user",
    streamKey: "user:local-b",
    streamState: "none",
    message: "second prompt",
    observedAt: "2999-01-01T00:00:02.000Z",
    metadata: {
      liveType: "thread.user_prompt",
      rewindTarget: { activityLineId: "user:local-b" },
    },
  });
  store.saveUserMessageRecord({
    threadId: "thr_claude_proj_rewind",
    activityLineId: "user:local-b",
    text: "second prompt",
    provider: "claude",
    createdAt: "2999-01-01T00:00:02.000Z",
  });
  store.bindLatestUserActivityToSdkMessage("thr_claude_proj_rewind", "sdk-user-b");

  store.appendThreadRunEvent({
    id: "evt_future",
    threadId: "thr_claude_proj_rewind",
    sequence: 3,
    eventType: "thread.status",
    scope: "main",
    streamState: "none",
    message: "future",
    observedAt: "3000-01-01T00:00:03.000Z",
  });

  const summary = store.rewindThreadToActivityLine("thr_claude_proj_rewind", "user:local-b");
  assert.deepEqual(
    {
      activityLineId: summary.activityLineId,
      userMessageId: summary.userMessageId,
      cutoffRunSequence: summary.cutoffRunSequence,
      removedRunEventCount: summary.removedRunEventCount,
    },
    {
      activityLineId: "user:local-b",
      userMessageId: "sdk-user-b",
      cutoffRunSequence: 2,
      removedRunEventCount: 2,
    },
  );
  assert.deepEqual(
    store.listThreadRunEvents("thr_claude_proj_rewind").map((event) => event.id),
    ["evt_prompt_a"],
  );
  assert.deepEqual(
    store.listFileCheckpoints("thr_claude_proj_rewind").map((checkpoint) => checkpoint.userMessageId),
    ["sdk-user-a"],
  );
  assert.equal(store.getUserMessageRecord("thr_claude_proj_rewind", "user:local-b"), undefined);
  assert.equal(
    store.getUserMessageRecord("thr_claude_proj_rewind", "user:local-a")?.upstreamMessageId,
    "sdk-user-a",
  );
});

test("Node SQLite discards an unstarted ACP user turn without clearing earlier todos", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-acp-discard-unstarted-");
  const store = await createConversationStore(path.join(directory, "eco-coding.sqlite"));
  const now = "2026-08-11T00:00:00.000Z";
  store.saveThread({
    id: "thr_acp_discard",
    title: "ACP discard",
    prompt: "first",
    workspacePath: "/tmp/project",
    status: "completed",
    message: "",
    coreKind: "acp",
    coreLockedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  store.appendActivityLine("thr_acp_discard", { id: "user:first", role: "user", message: "first" });
  store.appendThreadRunEvent({
    id: "evt_first",
    threadId: "thr_acp_discard",
    sequence: 1,
    eventType: "thread.status",
    scope: "main",
    role: "user",
    streamKey: "user:first",
    streamState: "none",
    message: "first",
    observedAt: "2026-08-11T00:00:01.000Z",
  });
  store.saveUserMessageRecord({
    threadId: "thr_acp_discard",
    activityLineId: "user:first",
    text: "first",
    provider: "acp",
  });
  store.replaceCoderTodos("thr_acp_discard", [
    {
      id: "todo_keep",
      threadId: "thr_acp_discard",
      title: "keep",
      detail: "",
      status: "pending",
      position: 0,
      updatedAt: now,
    },
  ]);
  store.appendActivityLine("thr_acp_discard", { id: "user:target", role: "user", message: "target" });
  store.appendThreadRunEvent({
    id: "evt_target",
    threadId: "thr_acp_discard",
    sequence: 2,
    eventType: "thread.status",
    scope: "main",
    role: "user",
    streamKey: "user:target",
    streamState: "none",
    message: "target",
    observedAt: "2026-08-11T00:00:02.000Z",
  });
  store.saveUserMessageRecord({
    threadId: "thr_acp_discard",
    activityLineId: "user:target",
    text: "target",
    provider: "acp",
  });
  store.appendThreadRunEvent({
    id: "evt_exhaust",
    threadId: "thr_acp_discard",
    sequence: 3,
    eventType: "message.final",
    scope: "main",
    streamState: "none",
    message: "Error: RetriableError: [resource_exhausted] Error",
    observedAt: "2026-08-11T00:00:03.000Z",
  });

  const summary = store.discardThreadTurnFromActivityLine("thr_acp_discard", "user:target");
  assert.equal(summary.activityLineId, "user:target");
  assert.deepEqual(
    store.listActivityLines("thr_acp_discard").map((line) => line.id),
    ["user:first"],
  );
  assert.deepEqual(
    store.listThreadRunEvents("thr_acp_discard").map((event) => event.id),
    ["evt_first"],
  );
  assert.deepEqual(
    store.listUserMessageRecords("thr_acp_discard").map((record) => record.activityLineId),
    ["user:first"],
  );
  assert.deepEqual(
    store.listCoderTodos("thr_acp_discard").map((todo) => todo.id),
    ["todo_keep"],
  );
});

test("Node SQLite repairs projection-only Claude history from transcript mappings", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-claude-history-rebind-");
  const store = await createConversationStore(path.join(directory, "eco-coding.sqlite"));
  const now = "2026-08-11T00:00:00.000Z";
  store.saveThread({
    id: "thr_claude_legacy",
    title: "Claude legacy",
    prompt: "legacy prompt",
    workspacePath: "/tmp/project",
    status: "completed",
    message: "ok",
    coreKind: "claude",
    coreLockedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  store.appendThreadRunEvent({
    id: "evt_legacy_prompt",
    threadId: "thr_claude_legacy",
    sequence: 1,
    eventType: "thread.status",
    scope: "main",
    role: "user",
    streamState: "none",
    message: "legacy prompt",
    observedAt: "2026-08-11T00:00:01.000Z",
    metadata: { liveType: "thread.user_prompt" },
  });
  store.saveFileCheckpoint("thr_claude_legacy", "sdk-user-legacy");

  const records = store.ensureClaudeUserMessageRecordsFromRunEvents("thr_claude_legacy");
  assert.equal(records.length, 1);
  assert.equal(records[0]?.activityLineId, "evt_legacy_prompt");

  store.rebindClaudeUserMessageRecords("thr_claude_legacy", [
    { activityLineId: "evt_legacy_prompt", upstreamMessageId: "sdk-user-legacy" },
  ]);

  assert.equal(
    store.getUserMessageRecord("thr_claude_legacy", "evt_legacy_prompt")?.upstreamMessageId,
    "sdk-user-legacy",
  );
  assert.deepEqual(
    store.listFileCheckpoints("thr_claude_legacy").map(({ userMessageId, activityLineId }) => ({
      userMessageId,
      activityLineId,
    })),
    [{ userMessageId: "sdk-user-legacy", activityLineId: "evt_legacy_prompt" }],
  );
  assert.deepEqual(store.listThreadRunEvents("thr_claude_legacy")[0]?.metadata?.rewindTarget, {
    activityLineId: "evt_legacy_prompt",
    userMessageId: "sdk-user-legacy",
  });
});

test("Node SQLite attributeThreadRunEventsByLogicalRequestId patches started+terminal atomically", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-late-bind-attr-");
  const store = await createConversationStore(path.join(directory, "eco-coding.sqlite"));
  const threadId = "thr_late_bind_db";
  const logicalRequestId = "req_late_bind_1";
  store.saveThread({
    id: threadId,
    title: "Late bind",
    prompt: "hi",
    workspacePath: "/tmp/late-bind",
    status: "running",
    message: "working",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  store.appendThreadRunEvent({
    id: "evt_started",
    threadId,
    eventType: "request.started",
    scope: "main",
    role: "coder",
    requestId: logicalRequestId,
    streamState: "finalized",
    message: "Requesting model…",
    observedAt: "2026-01-01T00:00:01.000Z",
  });
  store.appendThreadRunEvent({
    id: "evt_terminal",
    threadId,
    eventType: "request.completed",
    scope: "main",
    role: "coder",
    requestId: logicalRequestId,
    streamState: "finalized",
    message: "Request completed",
    observedAt: "2026-01-01T00:00:02.000Z",
  });

  const patched = store.attributeThreadRunEventsByLogicalRequestId(threadId, logicalRequestId, {
    agentId: "agent_a",
    role: "coder",
  });
  assert.deepEqual(patched, { updated: 2, conflict: false });

  const events = store.listThreadRunEvents(threadId);
  assert.equal(events.find((e) => e.id === "evt_started")?.agentId, "agent_a");
  assert.equal(events.find((e) => e.id === "evt_terminal")?.agentId, "agent_a");
  assert.equal(events.find((e) => e.id === "evt_started")?.scope, "agent");
  assert.equal(events.find((e) => e.id === "evt_terminal")?.scope, "agent");
});

test("Node SQLite attributeThreadRunEventsByLogicalRequestId conflict fail closed keeps all rows", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-late-bind-conflict-");
  const store = await createConversationStore(path.join(directory, "eco-coding.sqlite"));
  const threadId = "thr_late_bind_conflict";
  const logicalRequestId = "req_conflict_1";
  store.saveThread({
    id: threadId,
    title: "Late bind conflict",
    prompt: "hi",
    workspacePath: "/tmp/late-bind-conflict",
    status: "running",
    message: "working",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  store.appendThreadRunEvent({
    id: "evt_started",
    threadId,
    eventType: "request.started",
    scope: "agent",
    role: "coder",
    agentId: "agent_existing",
    requestId: logicalRequestId,
    streamState: "finalized",
    message: "Requesting model…",
    observedAt: "2026-01-01T00:00:01.000Z",
  });
  store.appendThreadRunEvent({
    id: "evt_terminal",
    threadId,
    eventType: "request.completed",
    scope: "main",
    role: "coder",
    requestId: logicalRequestId,
    streamState: "finalized",
    message: "Request completed",
    observedAt: "2026-01-01T00:00:02.000Z",
  });

  const patched = store.attributeThreadRunEventsByLogicalRequestId(threadId, logicalRequestId, {
    agentId: "agent_new",
    role: "coder",
  });
  assert.deepEqual(patched, { updated: 0, conflict: true });

  const events = store.listThreadRunEvents(threadId);
  assert.equal(events.find((e) => e.id === "evt_started")?.agentId, "agent_existing");
  assert.equal(events.find((e) => e.id === "evt_terminal")?.agentId, undefined);
  assert.equal(events.find((e) => e.id === "evt_terminal")?.scope, "main");
});

test("Node SQLite attributeThreadRunEventsByLogicalRequestId role conflict fail closed", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-late-bind-role-");
  const store = await createConversationStore(path.join(directory, "eco-coding.sqlite"));
  const threadId = "thr_late_bind_role";
  const logicalRequestId = "req_role_conflict";
  store.saveThread({
    id: threadId,
    title: "Late bind role",
    prompt: "hi",
    workspacePath: "/tmp/late-bind-role",
    status: "running",
    message: "working",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  store.appendThreadRunEvent({
    id: "evt_started",
    threadId,
    eventType: "request.started",
    scope: "main",
    role: "planner",
    requestId: logicalRequestId,
    streamState: "finalized",
    message: "Requesting model…",
    observedAt: "2026-01-01T00:00:01.000Z",
  });

  const patched = store.attributeThreadRunEventsByLogicalRequestId(threadId, logicalRequestId, {
    agentId: "agent_a",
    role: "coder",
  });
  assert.deepEqual(patched, { updated: 0, conflict: true });
  assert.equal(store.listThreadRunEvents(threadId)[0]?.agentId, undefined);
});

test("Node SQLite late-bind normalizes scope/role when agent_id already matches (idempotent replay)", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-late-bind-idempotent-");
  const store = await createConversationStore(path.join(directory, "eco-coding.sqlite"));
  const threadId = "thr_late_bind_idempotent";
  const logicalRequestId = "req_idempotent_1";
  store.saveThread({
    id: threadId,
    title: "Late bind idempotent",
    prompt: "hi",
    workspacePath: "/tmp/late-bind-idempotent",
    status: "running",
    message: "working",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  store.appendThreadRunEvent({
    id: "evt_started_main_scope",
    threadId,
    eventType: "request.started",
    scope: "main",
    role: "coder",
    agentId: "agent_a",
    requestId: logicalRequestId,
    streamState: "finalized",
    message: "Requesting model…",
    observedAt: "2026-01-01T00:00:01.000Z",
  });
  store.appendThreadRunEvent({
    id: "evt_thinking",
    threadId,
    eventType: "thinking.final",
    scope: "main",
    role: "thinking",
    agentId: "agent_a",
    requestId: logicalRequestId,
    streamState: "finalized",
    message: "…",
    observedAt: "2026-01-01T00:00:01.500Z",
  });
  store.appendThreadRunEvent({
    id: "evt_terminal_missing_role",
    threadId,
    eventType: "request.completed",
    scope: "main",
    agentId: "agent_a",
    requestId: logicalRequestId,
    streamState: "finalized",
    message: "Request completed",
    observedAt: "2026-01-01T00:00:02.000Z",
  });

  const first = store.attributeThreadRunEventsByLogicalRequestId(threadId, logicalRequestId, {
    agentId: "agent_a",
    role: "coder",
  });
  assert.ok(first.updated >= 2);
  assert.equal(first.conflict, false);

  const events = store.listThreadRunEvents(threadId);
  assert.equal(events.find((e) => e.id === "evt_started_main_scope")?.scope, "agent");
  assert.equal(events.find((e) => e.id === "evt_started_main_scope")?.role, "coder");
  assert.equal(events.find((e) => e.id === "evt_thinking")?.role, "thinking");
  assert.equal(events.find((e) => e.id === "evt_thinking")?.scope, "agent");
  assert.equal(events.find((e) => e.id === "evt_terminal_missing_role")?.role, "coder");
  assert.equal(events.find((e) => e.id === "evt_terminal_missing_role")?.scope, "agent");

  const replay = store.attributeThreadRunEventsByLogicalRequestId(threadId, logicalRequestId, {
    agentId: "agent_a",
    role: "coder",
  });
  assert.deepEqual(replay, { updated: 0, conflict: false });
});
