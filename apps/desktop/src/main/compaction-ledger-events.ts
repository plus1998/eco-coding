import type { AgentRole } from "../shared/ipc";
import { buildSingleUsageLedgerEvent } from "./usage-ledger-adapters";
import type { UsageLedgerEvent } from "./usage-ledger";

export type CompactionLedgerStage = "started" | "completed";

export interface CompactionLedgerEventInput {
  threadId: string;
  sourceEventId: string;
  stage: CompactionLedgerStage;
  trigger?: "auto" | "manual";
  sessionId?: string;
  archiveId?: string;
  runAttemptId?: string;
  plannerAgentId?: string;
  preTokens?: number;
  postTokens?: number;
  payload?: Record<string, unknown>;
}

export function buildCompactionLedgerEvent(input: CompactionLedgerEventInput): UsageLedgerEvent {
  const role: AgentRole = "planner";
  return buildSingleUsageLedgerEvent({
    threadId: input.threadId,
    role,
    source: "sdk",
    sourceEventId: input.sourceEventId,
    usageKind: "context",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
    ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
    ...(input.plannerAgentId && { agentId: input.plannerAgentId }),
    metadata: {
      path: "compaction",
      stage: input.stage,
      ...(input.trigger && { trigger: input.trigger }),
      ...(input.sessionId && { sessionId: input.sessionId }),
      ...(input.archiveId && { archiveId: input.archiveId }),
      ...(input.preTokens !== undefined && { preTokens: input.preTokens }),
      ...(input.postTokens !== undefined && { postTokens: input.postTokens }),
      ...(input.payload && { compactMetadata: input.payload }),
    },
  });
}

export function readCompactionBoundaryMetadata(payload: unknown): {
  trigger?: "auto" | "manual";
  sessionId?: string;
  preTokens?: number;
  postTokens?: number;
  rawMetadata?: Record<string, unknown>;
} {
  if (!isRecord(payload)) {
    return {};
  }
  const rawMetadata = isRecord(payload.compact_metadata) ? payload.compact_metadata : undefined;
  const trigger = readTrigger(rawMetadata?.trigger ?? payload.trigger);
  const sessionId = readString(payload.session_id) ?? readString(rawMetadata?.session_id);
  return {
    ...(trigger && { trigger }),
    ...(sessionId && { sessionId }),
    ...readTokenFields(rawMetadata),
    ...(rawMetadata && { rawMetadata }),
  };
}

export function readTokenFields(metadata: unknown): {
  preTokens?: number;
  postTokens?: number;
} {
  if (!isRecord(metadata)) {
    return {};
  }
  return {
    ...readFiniteNumberField(metadata, "pre_tokens", "preTokens"),
    ...readFiniteNumberField(metadata, "post_tokens", "postTokens"),
  };
}

function readFiniteNumberField(
  metadata: Record<string, unknown>,
  snakeKey: string,
  camelKey: "preTokens" | "postTokens",
): { preTokens?: number; postTokens?: number } {
  const value = metadata[snakeKey] ?? metadata[camelKey];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {};
  }
  return camelKey === "preTokens" ? { preTokens: value } : { postTokens: value };
}

function readTrigger(value: unknown): "auto" | "manual" | undefined {
  return value === "manual" ? "manual" : value === "auto" ? "auto" : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
