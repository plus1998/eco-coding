import type { ThreadUserMessageRecord } from "./conversation-store";

/**
 * A session-transcript user turn. An empty `upstreamMessageId` marks a line
 * that carries no provider id: it still occupies its position, it only cannot
 * be bound to a prompt.
 */
export interface ClaudePromptSessionLine {
  activityLineId: string;
  text: string;
  upstreamMessageId: string;
}

export interface ClaudeUserMessageRebindPlan {
  /** Bindings to persist: they only add identity, never change an existing one. */
  mappings: Array<{ activityLineId: string; upstreamMessageId: string }>;
  /** Candidates dropped because applying them would rewrite a durable history target. */
  rejected: Array<{
    activityLineId: string;
    upstreamMessageId: string;
    existing: { activityLineId: string; upstreamMessageId: string };
  }>;
}

/**
 * Pair Eco's user-prompt records with the provider session's user lines and
 * decide which bindings are safe to persist.
 *
 * The transcript is the only place a prompt's provider identity can be
 * recovered, and it is matched by position (equal counts) or by text — this is
 * the one prompt↔provider pairing without a shared identifier. A history target
 * is immutable once written (the V2 log and the provider rewind both keep the
 * first binding forever), so a dropped pairing is a recoverable loss of an
 * affordance, while a *changed* binding fails the append closed and blocks the
 * whole conversation. Hence: propose fill-ins only.
 */
export function planClaudeUserMessageRebindMappings(
  records: readonly ThreadUserMessageRecord[],
  userLines: readonly ClaudePromptSessionLine[],
): ClaudeUserMessageRebindPlan {
  const candidates = pairPromptRecordsWithSessionLines(records, userLines);
  const boundByActivityLine = new Map<string, string>();
  const boundByUpstreamId = new Map<string, string>();
  for (const record of records) {
    const upstreamMessageId = record.upstreamMessageId?.trim();
    if (!upstreamMessageId) {
      continue;
    }
    boundByActivityLine.set(record.activityLineId, upstreamMessageId);
    if (!boundByUpstreamId.has(upstreamMessageId)) {
      boundByUpstreamId.set(upstreamMessageId, record.activityLineId);
    }
  }

  const mappings: ClaudeUserMessageRebindPlan["mappings"] = [];
  const rejected: ClaudeUserMessageRebindPlan["rejected"] = [];
  for (const candidate of candidates) {
    const existingUpstreamId = boundByActivityLine.get(candidate.activityLineId);
    if (existingUpstreamId && existingUpstreamId !== candidate.upstreamMessageId) {
      rejected.push({
        ...candidate,
        existing: {
          activityLineId: candidate.activityLineId,
          upstreamMessageId: existingUpstreamId,
        },
      });
      continue;
    }
    const existingActivityLineId = boundByUpstreamId.get(candidate.upstreamMessageId);
    if (existingActivityLineId && existingActivityLineId !== candidate.activityLineId) {
      rejected.push({
        ...candidate,
        existing: {
          activityLineId: existingActivityLineId,
          upstreamMessageId: candidate.upstreamMessageId,
        },
      });
      continue;
    }
    mappings.push(candidate);
  }
  return { mappings, rejected };
}

function pairPromptRecordsWithSessionLines(
  records: readonly ThreadUserMessageRecord[],
  userLines: readonly ClaudePromptSessionLine[],
): Array<{ activityLineId: string; upstreamMessageId: string }> {
  const candidates: Array<{ activityLineId: string; upstreamMessageId: string }> = [];
  if (userLines.length === records.length) {
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const upstreamMessageId = userLines[index]?.upstreamMessageId.trim();
      if (record && upstreamMessageId) {
        candidates.push({ activityLineId: record.activityLineId, upstreamMessageId });
      }
    }
    return candidates;
  }

  let cursor = 0;
  for (const record of records) {
    const recordText = record.text.trim();
    const matchIndex = userLines.findIndex(
      (line, index) => index >= cursor && line.text.trim() === recordText,
    );
    if (matchIndex < 0) {
      continue;
    }
    const upstreamMessageId = userLines[matchIndex]?.upstreamMessageId.trim();
    if (upstreamMessageId) {
      candidates.push({ activityLineId: record.activityLineId, upstreamMessageId });
    }
    cursor = matchIndex + 1;
  }
  return candidates;
}
