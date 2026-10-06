import type { FeedShape, RowShape } from "./feed-shape";
import { sectionRows } from "./feed-shape";

/**
 * The Feed's rendered shape as a **cross-end contract**.
 *
 * Desktop and mobile render the Feed from the same V2 read models, so a conversation must
 * produce the same rows, in the same order, with the same roles, times, call identities and
 * agent cards on both ends. Each end has its own renderer and its own serializer; this file
 * is the definition the two serializers have to agree on, and the golden files under
 * `test/fixtures/feed-parity/v2-render/` are what both ends are compared against.
 *
 * What is deliberately *not* here:
 *
 * - **Tool row wording.** The two renderers word a call differently on purpose (structured
 *   input on one side, the provider's description on the other — see
 *   `docs/plans/feed-regression-test-plan.md` §4.13 K10). Rows keep `callId`, so "same call,
 *   same place, same outcome" is still compared.
 * - **Card row times.** A card's rows are positioned by the read models' approximation, and
 *   the contract is membership and order, not the exact instant; the main feed keeps times
 *   because both ends know those exactly.
 * - **Section boundaries.** Both ends group turns, but desktop's sections and mobile's
 *   activity feed group by different intermediate models. The contract is the flattened row
 *   sequence plus the turn boundary rows themselves.
 */
export interface CrossEndRow {
  /**
   * The row's text, for rows that carry a message body. A tool row's wording belongs to its
   * renderer (localized label vs `Tool: Name`), so its text is omitted and `callId` +
   * `status` carry the fact instead.
   */
  text?: string;
  role: string | null;
  at: string | null;
  callId: string | null;
  status?: string;
  final?: true;
}

export interface CrossEndCard {
  agentId: string;
  role: string;
  kind: string;
  status: string;
  missionText: string;
  taskName: string | null;
  parentToolUseId: string | null;
  rows: CrossEndRow[];
}

export interface CrossEndShape {
  /** Every row the feed draws, in order, across all sections of the conversation. */
  feed: CrossEndRow[];
  /** The subagent cards, as drawn: identity, the text a reader sees, and their rows. */
  cards: CrossEndCard[];
  attempts: Array<{ attemptId: string; status: string }>;
}

/**
 * Code-unit comparison. Both ends sort cards with this and nothing locale-aware: the two
 * runtimes have different collations, and the contract must not depend on which one a
 * renderer happens to use.
 */
function byCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function crossEndShape(shape: FeedShape): CrossEndShape {
  return {
    feed: shape.sections.flatMap((section) => sectionRows(section).map(toCrossEndRow)),
    // Cards are compared by identity, not by list position: each renderer draws a card where
    // the spawn row it absorbed used to be, so the list order is each end's own bookkeeping
    // rather than a fact either end can be wrong about. Sorting by identity here is what makes
    // the comparison keyed.
    cards: shape.cards
      .map((card) => ({
        agentId: card.agentId,
        role: card.role,
        kind: card.kind,
        status: card.status,
        missionText: card.missionText,
        taskName: card.taskName,
        parentToolUseId: card.parentToolUseId,
        // Membership and order, not the instant: see the file comment.
        rows: card.timeline.map((row) => toCrossEndRow({ ...row, at: undefined })),
      }))
      .sort((left, right) => byCodeUnit(left.agentId, right.agentId)),
    attempts: shape.attempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      status: attempt.status,
    })),
  };
}

/** Absent fields spelled as `null`, so both ends serialize the same keys. */
export function toCrossEndRow(row: RowShape): CrossEndRow {
  return {
    ...(row.callId ? {} : { text: row.text }),
    role: row.role ?? null,
    at: row.at ?? null,
    callId: row.callId ?? null,
    ...(row.status ? { status: row.status } : {}),
    ...(row.final ? { final: true as const } : {}),
  };
}
