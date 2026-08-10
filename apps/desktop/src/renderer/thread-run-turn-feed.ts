import type { ThreadRunProjectionAttempt, ThreadRunProjectionSnapshot } from "../shared/ipc";
import type { ThreadRunProjectionMainFeedEntry } from "./thread-run-projection-view";
import { isProjectionUserPromptItem, projectionItemToDetailBlock } from "./thread-run-projection-view";

export type ThreadRunTurnFeedSection =
  | {
      kind: "entry";
      key: string;
      entry: ThreadRunProjectionMainFeedEntry;
    }
  | {
      kind: "turn";
      key: string;
      attempt: ThreadRunProjectionAttempt;
      running: boolean;
      processEntries: ThreadRunProjectionMainFeedEntry[];
      finalEntry?: ThreadRunProjectionMainFeedEntry;
    };

export function buildThreadRunTurnFeedSections(
  entries: readonly ThreadRunProjectionMainFeedEntry[],
  projection: Pick<ThreadRunProjectionSnapshot, "attempts" | "timeline">,
): ThreadRunTurnFeedSection[] {
  const attempts = [...projection.attempts].sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt),
  );
  const attemptById = new Map(attempts.map((attempt) => [attempt.attemptId, attempt]));
  type MutableTurnSection = Extract<ThreadRunTurnFeedSection, { kind: "turn" }> & {
    entries: ThreadRunProjectionMainFeedEntry[];
  };
  type OrderedSection = {
    section: ThreadRunTurnFeedSection;
    at: string;
    sequence: number;
  };
  const sections: OrderedSection[] = [];
  const turnByAttemptId = new Map<string, MutableTurnSection>();
  const visibleTimelineAttemptIds = new Set(
    projection.timeline.flatMap((item) => (item.runAttemptId?.trim() ? [item.runAttemptId.trim()] : [])),
  );

  for (const entry of entries) {
    if (entry.kind === "timeline" && isProjectionUserPromptItem(entry.item)) {
      sections.push({
        section: { kind: "entry", key: `standalone:${entry.key}`, entry },
        at: entry.at,
        sequence: entry.sequence,
      });
      continue;
    }
    const attempt = resolveEntryAttempt(entry, attempts, attemptById);
    if (!attempt) {
      sections.push({
        section: { kind: "entry", key: `standalone:${entry.key}`, entry },
        at: entry.at,
        sequence: entry.sequence,
      });
      continue;
    }
    let turn = turnByAttemptId.get(attempt.attemptId);
    if (!turn) {
      turn = {
        kind: "turn",
        key: `turn:${attempt.attemptId}`,
        attempt,
        running: attempt.status === "running",
        processEntries: [],
        entries: [],
      };
      turnByAttemptId.set(attempt.attemptId, turn);
    }
    turn.entries.push(entry);
  }

  for (const attempt of attempts) {
    if (
      attempt.status === "completed" ||
      turnByAttemptId.has(attempt.attemptId) ||
      (attempt.status !== "running" && !visibleTimelineAttemptIds.has(attempt.attemptId))
    ) {
      continue;
    }
    const turn = {
      kind: "turn" as const,
      key: `turn:${attempt.attemptId}`,
      attempt,
      running: attempt.status === "running",
      processEntries: [],
      entries: [],
    };
    turnByAttemptId.set(attempt.attemptId, turn);
  }

  for (const turn of turnByAttemptId.values()) {
    sections.push({
      section: turn,
      // Attempt start is authoritative. A late terminal event from an older
      // attempt must not move that stopped turn below a newer running turn.
      at: turn.attempt.startedAt,
      sequence:
        turn.entries.length > 0
          ? Math.min(...turn.entries.map((entry) => entry.sequence))
          : Number.MAX_SAFE_INTEGER,
    });
  }

  sections.sort(compareOrderedSections);

  return sections.map(({ section }) => {
    if (section.kind !== "turn") {
      return section;
    }
    const collected = turnByAttemptId.get(section.attempt.attemptId);
    const turnEntries = collected?.entries ?? [];
    const finalEntry = section.running ? undefined : resolveFinalOutputEntry(turnEntries);
    return {
      kind: "turn",
      key: section.key,
      attempt: section.attempt,
      running: section.running,
      processEntries: finalEntry ? turnEntries.filter((entry) => entry.key !== finalEntry.key) : turnEntries,
      ...(finalEntry && { finalEntry }),
    };
  });
}

function compareOrderedSections(
  left: { section: ThreadRunTurnFeedSection; at: string; sequence: number },
  right: { section: ThreadRunTurnFeedSection; at: string; sequence: number },
): number {
  const atDiff = left.at.localeCompare(right.at);
  if (atDiff !== 0) {
    return atDiff;
  }
  const sequenceDiff = left.sequence - right.sequence;
  if (sequenceDiff !== 0) {
    return sequenceDiff;
  }
  if (left.section.kind !== right.section.kind) {
    return left.section.kind === "entry" ? -1 : 1;
  }
  return left.section.key.localeCompare(right.section.key);
}

function resolveEntryAttempt(
  entry: ThreadRunProjectionMainFeedEntry,
  attempts: readonly ThreadRunProjectionAttempt[],
  attemptById: ReadonlyMap<string, ThreadRunProjectionAttempt>,
): ThreadRunProjectionAttempt | undefined {
  const explicitId = readEntryAttemptId(entry);
  if (explicitId) {
    const explicit = attemptById.get(explicitId);
    if (explicit) return explicit;
  }
  const at = entry.at;
  let candidate: ThreadRunProjectionAttempt | undefined;
  for (const attempt of attempts) {
    if (attempt.startedAt > at) break;
    candidate = attempt;
  }
  return candidate;
}

function readEntryAttemptId(entry: ThreadRunProjectionMainFeedEntry): string | undefined {
  if (entry.kind === "timeline" || entry.kind === "agent-echo") {
    return entry.item.runAttemptId?.trim() || undefined;
  }
  if (entry.kind === "tool-group") {
    for (const child of entry.entries) {
      const attemptId = child.item.runAttemptId?.trim();
      if (attemptId) return attemptId;
    }
    return undefined;
  }
  return entry.card.agent.runAttemptId?.trim() || undefined;
}

function resolveFinalOutputEntry(
  entries: readonly ThreadRunProjectionMainFeedEntry[],
): ThreadRunProjectionMainFeedEntry | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.kind !== "timeline" || entry.item.eventType !== "message.final") {
      continue;
    }
    if (entry.item.role === "user" || entry.item.role === "tool" || entry.item.role === "thinking") {
      continue;
    }
    const block = projectionItemToDetailBlock(entry.item);
    if (block?.kind === "narrative" && !block.streaming && block.text.trim()) {
      return entry;
    }
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.kind !== "timeline") continue;
    const block = projectionItemToDetailBlock(entry.item);
    if (block?.kind === "api-error" || block?.kind === "tool-failed") {
      return entry;
    }
  }
  return undefined;
}
