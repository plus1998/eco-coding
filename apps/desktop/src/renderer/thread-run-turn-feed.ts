import type {
  ThreadRunProjectionAttempt,
  ThreadRunProjectionSnapshot,
} from "../shared/ipc";
import { isProjectionUserPromptItem, projectionItemToDetailBlock } from "./thread-run-projection-view";
import type { ThreadRunProjectionMainFeedEntry } from "./thread-run-projection-view";

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
  projection: Pick<ThreadRunProjectionSnapshot, "attempts">,
): ThreadRunTurnFeedSection[] {
  const attempts = [...projection.attempts].sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt),
  );
  const attemptById = new Map(attempts.map((attempt) => [attempt.attemptId, attempt]));
  const sections: ThreadRunTurnFeedSection[] = [];
  const turnByAttemptId = new Map<
    string,
    Extract<ThreadRunTurnFeedSection, { kind: "turn" }> & {
      entries: ThreadRunProjectionMainFeedEntry[];
    }
  >();

  for (const entry of entries) {
    if (entry.kind === "timeline" && isProjectionUserPromptItem(entry.item)) {
      sections.push({ kind: "entry", key: `standalone:${entry.key}`, entry });
      continue;
    }
    const attempt = resolveEntryAttempt(entry, attempts, attemptById);
    if (!attempt) {
      sections.push({ kind: "entry", key: `standalone:${entry.key}`, entry });
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
      sections.push(turn);
    }
    turn.entries.push(entry);
  }

  for (const attempt of attempts) {
    if (attempt.status !== "running" || turnByAttemptId.has(attempt.attemptId)) {
      continue;
    }
    const turn = {
      kind: "turn" as const,
      key: `turn:${attempt.attemptId}`,
      attempt,
      running: true,
      processEntries: [],
      entries: [],
    };
    turnByAttemptId.set(attempt.attemptId, turn);
    sections.push(turn);
  }

  return sections.map((section) => {
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
      processEntries: finalEntry
        ? turnEntries.filter((entry) => entry.key !== finalEntry.key)
        : turnEntries,
      ...(finalEntry && { finalEntry }),
    };
  });
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
    if (!entry || entry.kind !== "timeline" || entry.item.eventType !== "message.final") {
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
    if (!entry || entry.kind !== "timeline") continue;
    const block = projectionItemToDetailBlock(entry.item);
    if (block?.kind === "api-error" || block?.kind === "tool-failed") {
      return entry;
    }
  }
  return undefined;
}
