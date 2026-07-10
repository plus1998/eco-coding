import { readFile } from "node:fs/promises";
import type { RuntimeAgentRole } from "../shared/ipc";

export type SubagentTerminalReconciliationStatus =
  | "reconciled"
  | "partial_parse"
  | "missing_transcript_path"
  | "transcript_read_failed"
  | "no_assistant_message_ids";

export interface SubagentTranscriptParseResult {
  messageIds: string[];
  duplicateMessageCount: number;
  invalidLineNumbers: number[];
}

export interface SubagentTerminalReconciliationResult extends SubagentTranscriptParseResult {
  status: SubagentTerminalReconciliationStatus;
  settledUsageCount: number;
  attributedFeedEventCount: number;
}

export interface ReconcileSubagentTerminalTranscriptInput {
  threadId: string;
  agentId: string;
  role: RuntimeAgentRole;
  agentTranscriptPath?: string;
  parentToolUseId?: string;
  readTranscript?: (path: string) => Promise<string>;
  bindMessageIdentity(input: {
    messageId: string;
    agentId: string;
    role: RuntimeAgentRole;
    parentToolUseId?: string;
  }): number;
  attributeFeedEvents(messageIds: readonly string[], agentId: string): number;
  logDiagnostic(topic: string, fields: Record<string, unknown>): void;
}

export function parseSubagentAssistantMessageIds(jsonl: string): SubagentTranscriptParseResult {
  const messageIds: string[] = [];
  const seen = new Set<string>();
  const invalidLineNumbers: number[] = [];
  let duplicateMessageCount = 0;

  for (const [index, rawLine] of jsonl.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      invalidLineNumbers.push(index + 1);
      continue;
    }
    if (!isRecord(parsed) || parsed.type !== "assistant" || !isRecord(parsed.message)) {
      continue;
    }
    const messageId = typeof parsed.message.id === "string" ? parsed.message.id.trim() : "";
    if (!messageId) {
      continue;
    }
    if (seen.has(messageId)) {
      duplicateMessageCount += 1;
      continue;
    }
    seen.add(messageId);
    messageIds.push(messageId);
  }

  return { messageIds, duplicateMessageCount, invalidLineNumbers };
}

export async function reconcileSubagentTerminalTranscript(
  input: ReconcileSubagentTerminalTranscriptInput,
): Promise<SubagentTerminalReconciliationResult> {
  const transcriptPath = input.agentTranscriptPath?.trim();
  if (!transcriptPath) {
    const result = emptyResult("missing_transcript_path");
    logResult(input, result);
    return result;
  }

  let jsonl: string;
  try {
    jsonl = await (input.readTranscript ?? readUtf8File)(transcriptPath);
  } catch (error) {
    const result = emptyResult("transcript_read_failed");
    input.logDiagnostic("subagent.terminal_reconciliation", {
      threadId: input.threadId,
      agentId: input.agentId,
      role: input.role,
      status: result.status,
      agentTranscriptPath: transcriptPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return result;
  }

  const parsed = parseSubagentAssistantMessageIds(jsonl);
  if (parsed.messageIds.length === 0) {
    const result: SubagentTerminalReconciliationResult = {
      ...parsed,
      status: "no_assistant_message_ids",
      settledUsageCount: 0,
      attributedFeedEventCount: 0,
    };
    logResult(input, result, transcriptPath);
    return result;
  }

  let settledUsageCount = 0;
  for (const messageId of parsed.messageIds) {
    settledUsageCount += input.bindMessageIdentity({
      messageId,
      agentId: input.agentId,
      role: input.role,
      ...(input.parentToolUseId?.trim() && { parentToolUseId: input.parentToolUseId.trim() }),
    });
  }
  const attributedFeedEventCount = input.attributeFeedEvents(parsed.messageIds, input.agentId);
  const result: SubagentTerminalReconciliationResult = {
    ...parsed,
    status: parsed.invalidLineNumbers.length > 0 ? "partial_parse" : "reconciled",
    settledUsageCount,
    attributedFeedEventCount,
  };
  logResult(input, result, transcriptPath);
  return result;
}

function emptyResult(
  status: Extract<SubagentTerminalReconciliationStatus, "missing_transcript_path" | "transcript_read_failed">,
): SubagentTerminalReconciliationResult {
  return {
    status,
    messageIds: [],
    duplicateMessageCount: 0,
    invalidLineNumbers: [],
    settledUsageCount: 0,
    attributedFeedEventCount: 0,
  };
}

function logResult(
  input: ReconcileSubagentTerminalTranscriptInput,
  result: SubagentTerminalReconciliationResult,
  transcriptPath?: string,
): void {
  input.logDiagnostic("subagent.terminal_reconciliation", {
    threadId: input.threadId,
    agentId: input.agentId,
    role: input.role,
    status: result.status,
    ...(transcriptPath && { agentTranscriptPath: transcriptPath }),
    ...(input.parentToolUseId?.trim() && { parentToolUseId: input.parentToolUseId.trim() }),
    messageCount: result.messageIds.length,
    duplicateMessageCount: result.duplicateMessageCount,
    invalidLineCount: result.invalidLineNumbers.length,
    ...(result.invalidLineNumbers.length > 0 && {
      invalidLineNumbers: result.invalidLineNumbers.slice(0, 20),
    }),
    settledUsageCount: result.settledUsageCount,
    attributedFeedEventCount: result.attributedFeedEventCount,
  });
}

async function readUtf8File(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
