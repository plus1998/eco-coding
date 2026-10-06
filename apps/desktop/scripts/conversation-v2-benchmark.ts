import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { type ConversationEventInput, estimateConversationBytes } from "@eco/shared";
import { ConversationV2Store } from "../src/main/conversation-v2-store";

const DEFAULT_EVENTS = 10_000;
const DEFAULT_BATCH_SIZE = 2_000;
const DEFAULT_BODY_BYTES = 256;
const DEFAULT_PAGE_BYTES = 256 * 1024;
const QUERY_SAMPLES = 8;

interface BenchmarkOptions {
  events: number;
  batchSize: number;
  bodyBytes: number;
  maxBytes: number;
  databasePath?: string;
  keepDatabase: boolean;
}

interface TimedQuery {
  firstMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

function numberOption(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  const value = argument ? Number(argument.slice(prefix.length)) : fallback;
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function booleanOption(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function stringOption(name: string): string | undefined {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument?.slice(prefix.length) || undefined;
}

function readOptions(): BenchmarkOptions {
  const bodyBytes = numberOption("body-bytes", DEFAULT_BODY_BYTES);
  const requestedMaxBytes = numberOption("max-bytes", DEFAULT_PAGE_BYTES);
  return {
    events: numberOption("events", DEFAULT_EVENTS),
    batchSize: numberOption("batch-size", DEFAULT_BATCH_SIZE),
    bodyBytes,
    maxBytes: Math.max(requestedMaxBytes, bodyBytes + 16 * 1024),
    databasePath: stringOption("db"),
    keepDatabase: booleanOption("keep-db"),
  };
}

function timestampFor(index: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, index)).toISOString();
}

function eventBatch(
  conversationId: string,
  runId: string,
  turnId: string,
  startIndex: number,
  count: number,
  body: string,
): ConversationEventInput[] {
  const events: ConversationEventInput[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const index = startIndex + offset;
    const occurredAt = timestampFor(index);
    // Every tenth content slot is a completed tool pair. This keeps the corpus
    // useful for both message and tool-summary pagination without making the
    // benchmark depend on renderer-only projection code.
    if (index % 10 === 0 && offset + 1 < count) {
      const toolCallId = `bench_tool_${index}`;
      events.push(
        {
          conversationId,
          eventId: `bench_tool_started_${index}`,
          sourceEventKey: `bench:tool:started:${index}`,
          type: "tool.started",
          occurredAt,
          turnId,
          runId,
          toolCallId,
          payload: {
            name: "benchmark.read",
            status: "running",
            input: { index, path: `/tmp/benchmark-${index}.txt` },
          },
        },
        {
          conversationId,
          eventId: `bench_tool_completed_${index}`,
          sourceEventKey: `bench:tool:completed:${index}`,
          type: "tool.completed",
          occurredAt: timestampFor(index + 1),
          turnId,
          runId,
          toolCallId,
          payload: {
            name: "benchmark.read",
            status: "completed",
            output: { index, bytes: body.length },
          },
        },
      );
      offset += 1;
      continue;
    }
    const messageId = `bench_message_${index}`;
    events.push({
      conversationId,
      eventId: `bench_message_created_${index}`,
      sourceEventKey: `bench:message:${index}`,
      type: "message.created",
      occurredAt,
      turnId,
      runId,
      messageId,
      payload: {
        role: "assistant",
        channel: "answer",
        status: "final",
        body: `${index.toString().padStart(8, "0")} ${body}`,
      },
    });
  }
  return events;
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function measureQuery<T>(query: () => T, samples = QUERY_SAMPLES): TimedQuery {
  const values: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    query();
    values.push(performance.now() - started);
  }
  return {
    firstMs: values[0] ?? 0,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    maxMs: Math.max(...values),
  };
}

function assertPageBudget(value: unknown, maxBytes: number, label: string): void {
  const bytes = estimateConversationBytes(value);
  if (bytes > maxBytes) throw new Error(`${label} exceeded maxBytes: ${bytes} > ${maxBytes}`);
}

function assertPageShape(
  page: { messages?: readonly unknown[]; tools?: readonly unknown[] },
  label: string,
  maxTools = 200,
): void {
  if (page.messages && page.messages.length > 30) throw new Error(`${label} returned too many messages`);
  if (page.tools && page.tools.length > maxTools) throw new Error(`${label} returned too many tools`);
}

async function run(): Promise<void> {
  const options = readOptions();
  const temporaryDirectory = options.databasePath
    ? undefined
    : await fs.mkdtemp(path.join(os.tmpdir(), "eco-v2-benchmark-"));
  if (!options.databasePath && !temporaryDirectory) {
    throw new Error("benchmark temporary directory was not created");
  }
  const databasePath = options.databasePath ?? path.join(temporaryDirectory, "conversation-v2.sqlite");
  const conversationId = "benchmark-conversation";
  const runId = "benchmark-run";
  const turnId = "benchmark-turn";
  const body = "x".repeat(Math.max(0, options.bodyBytes - 10));
  const pageEvents = Math.max(1, Math.min(200, Math.floor(options.maxBytes / (options.bodyBytes + 512))));
  const startedAt = performance.now();
  const db = new DatabaseSync(databasePath);
  const store = new ConversationV2Store(db, {
    now: () => "2026-01-02T00:00:00.000Z",
  });
  store.initialize();
  const initializedMs = performance.now() - startedAt;

  const writeStarted = performance.now();
  const runStarted: ConversationEventInput = {
    conversationId,
    eventId: "bench_run_started",
    sourceEventKey: "bench:run:started",
    type: "run.started",
    occurredAt: timestampFor(0),
    turnId,
    runId,
    payload: { status: "running", startedAt: timestampFor(0) },
  };
  store.append(runStarted);
  let written = 1;
  let nextContentIndex = 1;
  const contentTarget = Math.max(0, options.events - 2);
  while (written < contentTarget + 1) {
    const remainingContent = contentTarget - (written - 1);
    const count = Math.min(options.batchSize, remainingContent);
    const batch = eventBatch(conversationId, runId, turnId, nextContentIndex, count, body);
    store.appendBatch(batch);
    written += batch.length;
    nextContentIndex += count;
  }
  if (options.events >= 2) {
    store.append({
      conversationId,
      eventId: "bench_run_completed",
      sourceEventKey: "bench:run:completed",
      type: "run.completed",
      occurredAt: timestampFor(options.events - 1),
      turnId,
      runId,
      payload: { status: "completed", endedAt: timestampFor(options.events - 1) },
    });
    written += 1;
  }
  if (written !== options.events)
    throw new Error(`benchmark wrote ${written} events, expected ${options.events}`);
  const writeMs = performance.now() - writeStarted;

  const head = store.head(conversationId);
  if (head.lastSeq !== options.events) throw new Error(`head seq ${head.lastSeq} != ${options.events}`);
  const bootstrap = store.bootstrap(conversationId, 30, options.maxBytes);
  const messages = store.messagesPage(conversationId, undefined, 30, options.maxBytes);
  const tools = store.toolsPage(conversationId, runId, undefined, 50, options.maxBytes);
  const sync = store.sync(conversationId, store.getStoreEpoch(), 0, undefined, pageEvents, options.maxBytes);
  assertPageBudget(bootstrap, options.maxBytes, "bootstrap");
  assertPageBudget(messages, options.maxBytes, "messagesPage");
  assertPageBudget(tools, options.maxBytes, "toolsPage");
  assertPageBudget(sync, options.maxBytes, "sync");
  assertPageShape(bootstrap, "bootstrap");
  assertPageShape(messages, "messagesPage");
  assertPageShape(tools, "toolsPage", 50);
  if (sync.throughSeq <= 0 || sync.throughSeq > head.lastSeq) throw new Error("sync cursor is invalid");

  const queryMs = {
    bootstrap: measureQuery(() => store.bootstrap(conversationId, 30, options.maxBytes)),
    messagesPage: measureQuery(() => store.messagesPage(conversationId, undefined, 30, options.maxBytes)),
    toolsPage: measureQuery(() => store.toolsPage(conversationId, runId, undefined, 50, options.maxBytes)),
    sync: measureQuery(() =>
      store.sync(conversationId, store.getStoreEpoch(), 0, undefined, pageEvents, options.maxBytes),
    ),
  };
  const beforeCloseRss = process.memoryUsage().rss;
  db.close();
  const fileBytes = (await fs.stat(databasePath)).size;
  const reopenStarted = performance.now();
  const reopenedDb = new DatabaseSync(databasePath);
  const reopenedStore = new ConversationV2Store(reopenedDb);
  reopenedStore.initialize();
  const reopenedBootstrap = reopenedStore.bootstrap(conversationId, 30, options.maxBytes);
  assertPageBudget(reopenedBootstrap, options.maxBytes, "reopened bootstrap");
  if (reopenedStore.head(conversationId).lastSeq !== options.events) throw new Error("reopen lost head seq");
  const reopenMs = performance.now() - reopenStarted;
  const afterReopenRss = process.memoryUsage().rss;
  reopenedDb.close();

  const result = {
    benchmark: "conversation-v2-sqlite",
    generatedAt: new Date().toISOString(),
    dataset: {
      events: options.events,
      bodyBytes: options.bodyBytes,
      batchSize: options.batchSize,
      pageMaxBytes: options.maxBytes,
      syncPageEvents: pageEvents,
      databasePath,
      databaseBytes: fileBytes,
    },
    write: {
      initializeMs: Number(initializedMs.toFixed(3)),
      appendMs: Number(writeMs.toFixed(3)),
      eventsPerSecond: Number((options.events / (writeMs / 1000)).toFixed(1)),
    },
    queries: Object.fromEntries(
      Object.entries(queryMs).map(([name, timing]) => [
        name,
        Object.fromEntries(Object.entries(timing).map(([key, value]) => [key, Number(value.toFixed(3))])),
      ]),
    ),
    pages: {
      bootstrapMessages: bootstrap.messages.length,
      bootstrapTools: bootstrap.tools.length,
      messages: messages.messages.length,
      tools: tools.tools.length,
      toolsTotal: tools.totalCount,
      syncEffects: sync.effects.length,
      syncThroughSeq: sync.throughSeq,
      syncHasMore: sync.hasMore,
    },
    memory: {
      rssBeforeCloseBytes: beforeCloseRss,
      rssAfterReopenBytes: afterReopenRss,
    },
    reopen: {
      openAndBootstrapMs: Number(reopenMs.toFixed(3)),
    },
  };
  console.log(JSON.stringify(result, null, 2));

  if (!options.keepDatabase && !options.databasePath) {
    if (!temporaryDirectory) throw new Error("benchmark temporary directory is missing during cleanup");
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  } else if (!options.databasePath) {
    console.error(`benchmark database kept at ${databasePath}`);
  }
}

await run();
