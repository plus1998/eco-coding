import { readFileSync } from "node:fs";
import { buildThreadRunProjection } from "../../src/main/thread-run-projection";
import { trimProjectionForFeed } from "../../src/main/thread-run-projection-feed";
import { isMetricsOnlyThreadRunEvent } from "../../src/main/thread-run-event-normalizer";
import type { AgentInstanceRecord, RunAttemptRecord } from "../../src/main/usage-ledger";
import type {
  ThreadRunEvent,
  ThreadRunEventScope,
  ThreadRunEventStreamState,
  ThreadRunEventType,
} from "../../src/shared/ipc";
import type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionTimelineItem,
} from "../../src/shared/thread-run-projection";

/**
 * Test corpus built from the *shape* of real persisted run events.
 *
 * `test/fixtures/feed-parity/observed-event-shapes.json` is derived from the local dev and
 * prod event logs (138 threads): every distinct (eventType, scope, role, streamState,
 * flags, metadata key/type set) combination that actually occurs, plus real frequencies.
 * No message text and no ids are stored — only the shape.
 *
 * Tests use it two ways:
 *  - coverage: every observed shape is exercised at least once, so a rule that only holds
 *    for the shapes we happened to imagine cannot pass;
 *  - fuzzing: weighted-random streams over the observed shapes (seeded, reproducible).
 */

export interface ObservedEventShape {
  eventType: string;
  scope: string;
  role?: string;
  textEmpty: boolean;
  streamState: string;
  hasStreamKey: boolean;
  hasRunAttemptId: boolean;
  hasRequestId: boolean;
  hasAgentId: boolean;
  hasParentToolUseId: boolean;
  /** `key:type` pairs, sorted; values themselves are never stored. */
  metadata?: { keys: string; liveType?: string };
  count: number;
  databases: string[];
}

export interface ObservedShapeFile {
  generatedFrom: string;
  threadCount: number;
  threadsWithOrphanAgentRows: number;
  attemptStatusSets: string[];
  maxEventsPerThread: number;
  shapes: ObservedEventShape[];
}

export const CORPUS_THREAD_ID = "thr_corpus";
export const CORPUS_ATTEMPT_ID = "att_corpus";
export const CORPUS_AGENT_ID = "agent_corpus_unknown";
const CORPUS_STARTED_AT_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

export function loadObservedShapeFile(): ObservedShapeFile {
  return JSON.parse(
    readFileSync(new URL("../fixtures/feed-parity/observed-event-shapes.json", import.meta.url), "utf8"),
  ) as ObservedShapeFile;
}

export function createSeededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

/** Operational status lines that `isThreadFollowUpActivityMessage` recognises. */
const OPERATIONAL_TEXTS = [
  "已开始处理排队的后续消息。",
  "正在按计划执行…",
  "已停止",
  "正在交给主代理处理",
] as const;

function textForShape(shape: ObservedEventShape, index: number): string {
  if (shape.textEmpty) {
    return "";
  }
  // Every 7th text-bearing event is an operational status line: `isSkeletonUserPromptItem`
  // rejects those, so a corpus without them would never exercise that branch.
  if (index % 7 === 6) {
    return OPERATIONAL_TEXTS[index % OPERATIONAL_TEXTS.length]!;
  }
  const liveType = shape.metadata?.liveType;
  if (liveType === "thread.user_prompt" || liveType === "message.user" || shape.role === "user") {
    return `用户提问 ${index}`;
  }
  return `正文 ${index}`;
}

function metadataForShape(
  shape: ObservedEventShape,
  index: number,
): Record<string, unknown> | undefined {
  const shapeMetadata = shape.metadata;
  if (!shapeMetadata) {
    return undefined;
  }
  const metadata: Record<string, unknown> = {};
  for (const entry of shapeMetadata.keys.split(",")) {
    const [key, type] = entry.split(":");
    if (!key) {
      continue;
    }
    if (key === "liveType") {
      metadata[key] = shapeMetadata.liveType;
      continue;
    }
    switch (type) {
      case "object":
        metadata[key] = objectValueForKey(key, index);
        break;
      case "array":
        metadata[key] = [objectValueForKey(key, index)];
        break;
      case "boolean":
        metadata[key] = index % 2 === 0;
        break;
      case "null":
        metadata[key] = null;
        break;
      case "number":
        metadata[key] = index;
        break;
      default:
        metadata[key] = stringValueForKey(key, index);
    }
  }
  return metadata;
}

function stringValueForKey(key: string, index: number): string {
  switch (key) {
    case "sdkMessageId":
      // Shared across a few blocks so a replayed settled block shows up in the corpus.
      return `sdk-block-${index % 4}`;
    case "sdkStreamBlockKey":
      return `sdk-stream-${index % 3}`;
    case "status":
      return index % 2 === 0 ? "started" : "completed";
    case "itemType":
      return "assistant_message";
    case "codexMethod":
      return "turn/started";
    case "source":
      return index % 2 === 0 ? "sdk" : "codex";
    case "providerRequestId":
      return `provider-${index % 3}`;
    case "thinkingDurationMs":
      return String(index);
    case "thinkingStartedAt":
      return new Date(CORPUS_STARTED_AT_MS + index * 1_000).toISOString();
    default:
      return `v${index}`;
  }
}

function objectValueForKey(key: string, index: number): Record<string, unknown> {
  switch (key) {
    case "tool":
      return { name: "Bash", detail: `echo ${index}`, toolUseId: `tool-${index}`, status: "started" };
    case "bashApproval":
      return { toolUseId: `tool-${index}`, phase: "requested", toolName: "Bash", detail: `echo ${index}` };
    case "apiError":
      return { message: `上游错误 ${index}` };
    case "rewindTarget":
      return { activityLineId: `user:${index}` };
    default:
      return {};
  }
}

export interface EventContext {
  threadId?: string;
  sequence: number;
  attemptId?: string;
}

export function eventFromShape(
  shape: ObservedEventShape,
  context: EventContext,
): ThreadRunEvent {
  const metadata = metadataForShape(shape, context.sequence);
  return {
    id: `${shape.eventType.replace(/\./g, "_")}_${context.sequence}`,
    threadId: context.threadId ?? CORPUS_THREAD_ID,
    sequence: context.sequence,
    eventType: shape.eventType as ThreadRunEventType,
    scope: shape.scope as ThreadRunEventScope,
    streamState: shape.streamState as ThreadRunEventStreamState,
    message: textForShape(shape, context.sequence),
    observedAt: new Date(CORPUS_STARTED_AT_MS + context.sequence * 1_000).toISOString(),
    ...(shape.role ? { role: shape.role } : {}),
    ...(shape.hasAgentId ? { agentId: CORPUS_AGENT_ID } : {}),
    ...(shape.hasParentToolUseId ? { parentToolUseId: `tool-${context.sequence}` } : {}),
    ...(shape.hasRunAttemptId && context.attemptId ? { runAttemptId: context.attemptId } : {}),
    ...(shape.hasRequestId ? { requestId: `req_${context.sequence % 3}` } : {}),
    // Two stream keys so deltas for the same stream are re-emitted (replacement path) and
    // deltas for different streams coexist. Scope is part of the key because real data never
    // shares one stream identity across scopes (0 of 138 threads), and the store collapses
    // deltas by identity without looking at scope.
    ...(shape.hasStreamKey
      ? { streamKey: `${shape.scope}_stream_${context.sequence % 2}` }
      : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export interface CorpusStream {
  events: ThreadRunEvent[];
  /** Attempt status the store reports from `sequence` onward (models finishRunAttempt). */
  attemptStatusBySequence: Array<{ sequence: number; status: RunAttemptRecord["status"] }>;
  finalStatus: RunAttemptRecord["status"];
  /** Shape of each event, index-aligned with `events`. */
  shapes: ObservedEventShape[];
}

export function corpusAttemptRecord(
  status: RunAttemptRecord["status"],
  attemptId = CORPUS_ATTEMPT_ID,
  threadId = CORPUS_THREAD_ID,
): RunAttemptRecord {
  return {
    attemptId,
    threadId,
    phase: "run",
    retryIndex: 0,
    status,
    startedAt: new Date(CORPUS_STARTED_AT_MS).toISOString(),
    ...(status === "running" ? {} : { endedAt: new Date(CORPUS_STARTED_AT_MS + 3_600_000).toISOString() }),
  };
}

/** Attempt rows as the patch context would see them at a given event sequence. */
export function attemptsAtSequence(
  stream: CorpusStream,
  sequence: number,
): RunAttemptRecord[] {
  let status: RunAttemptRecord["status"] = "running";
  for (const transition of stream.attemptStatusBySequence) {
    if (transition.sequence <= sequence) {
      status = transition.status;
    }
  }
  return [corpusAttemptRecord(status)];
}

export interface GenerateStreamOptions {
  seed: number;
  shapes: readonly ObservedEventShape[];
  count?: number;
  /** Emit a terminal attempt-status flip partway through the stream. */
  finishAttempt?: boolean;
  finalStatus?: RunAttemptRecord["status"];
  /** Set false to iterate shapes in order instead of weighted-random sampling. */
  sampleWeighted?: boolean;
}

export function generateStream(options: GenerateStreamOptions): CorpusStream {
  const random = createSeededRandom(options.seed);
  const count = options.count ?? 24;
  const shapes: ObservedEventShape[] = [];
  if (options.sampleWeighted === false) {
    for (let index = 0; index < count; index += 1) {
      shapes.push(options.shapes[index % options.shapes.length]!);
    }
  } else {
    const pool: ObservedEventShape[] = [];
    for (const shape of options.shapes) {
      // Frequency-weighted, but at least one slot so rare shapes still appear.
      const weight = Math.max(1, Math.min(20, Math.round(shape.count / 40)));
      for (let slot = 0; slot < weight; slot += 1) {
        pool.push(shape);
      }
    }
    for (let index = 0; index < count; index += 1) {
      shapes.push(pool[Math.floor(random() * pool.length)]!);
    }
  }
  const events = shapes.map((shape, index) =>
    eventFromShape(shape, { sequence: index + 1, attemptId: CORPUS_ATTEMPT_ID }),
  );
  const finalStatus = options.finalStatus ?? "completed";
  const attemptStatusBySequence =
    options.finishAttempt === false
      ? []
      : [{ sequence: Math.max(1, Math.ceil(count / 2)), status: finalStatus }];
  return { events, shapes, attemptStatusBySequence, finalStatus };
}

/**
 * Mirrors what a rebuild actually reads: `listThreadRunEventsForProjection` collapses
 * stream deltas to the newest event per stream identity before projecting.
 */
export function collapseStreamDeltas(events: readonly ThreadRunEvent[]): ThreadRunEvent[] {
  const seen = new Map<string, number>();
  const kept: ThreadRunEvent[] = [];
  for (const event of events) {
    const collapsible =
      (event.eventType === "message.delta" || event.eventType === "thinking.delta") &&
      Boolean(event.streamKey?.trim());
    if (!collapsible) {
      kept.push(event);
      continue;
    }
    const identity = [
      event.eventType,
      event.streamKey?.trim(),
      event.requestId ?? "",
      event.runAttemptId ?? "",
    ].join("\0");
    const index = seen.get(identity);
    if (index !== undefined) {
      kept[index] = event;
      continue;
    }
    seen.set(identity, kept.length);
    kept.push(event);
  }
  return kept;
}

/** Agent instance for `CORPUS_AGENT_ID`; registering it prevents orphan-agent promotion. */
export function corpusAgentInstance(): AgentInstanceRecord {
  return {
    threadId: CORPUS_THREAD_ID,
    agentId: CORPUS_AGENT_ID,
    role: "coder",
    kind: "subagent",
    status: "completed",
    runAttemptId: CORPUS_ATTEMPT_ID,
    startedAt: new Date(CORPUS_STARTED_AT_MS).toISOString(),
    endedAt: new Date(CORPUS_STARTED_AT_MS + 3_600_000).toISOString(),
    updatedAt: new Date(CORPUS_STARTED_AT_MS + 3_600_000).toISOString(),
  };
}

export function corpusProjectionAgent(): ThreadRunProjectionAgent {
  return {
    agentId: CORPUS_AGENT_ID,
    role: "coder",
    kind: "subagent",
    status: "completed",
    startedAt: new Date(CORPUS_STARTED_AT_MS).toISOString(),
    durationMs: 1_000,
    timeline: [],
  };
}

export function rebuildFeedTimeline(
  events: readonly ThreadRunEvent[],
  attempts: readonly RunAttemptRecord[],
  options: { status?: string; agents?: readonly AgentInstanceRecord[] } = {},
): ThreadRunProjectionTimelineItem[] {
  const projection = buildThreadRunProjection({
    threadId: CORPUS_THREAD_ID,
    status: options.status ?? "running",
    attempts: [...attempts],
    agents: [...(options.agents ?? [])],
    events: collapseStreamDeltas(events),
    historyComplete: true,
  });
  return trimProjectionForFeed(projection).timeline;
}

export function timelineSignature(
  timeline: readonly ThreadRunProjectionTimelineItem[],
): string[] {
  return timeline.map((item) => `${item.id}@${item.sequence}:${item.text}`);
}

/** True when the shape would be persisted at all (metrics-only live types never are). */
export function isPersistableShape(shape: ObservedEventShape): boolean {
  return !isMetricsOnlyThreadRunEvent({
    metadata: shape.metadata?.liveType ? { liveType: shape.metadata.liveType } : undefined,
  });
}
