/**
 * Canary: the incremental Feed skeleton patch must equal a full rebuild on real data.
 *
 * Replays every thread of a local Eco database through the production sequence — a rebuild
 * at some point, then the remaining run events folded in incrementally — and deep-compares
 * the resulting Feed against a full rebuild over the same event prefix. Also checks that a
 * freshly rebuilt skeleton does not re-trigger the load-path rebuild detectors (a detector
 * that keeps firing means a rebuild on every projection emit).
 *
 * Unit tests cover this with synthetic streams built from the observed event shapes
 * (`test/fixtures/feed-parity/observed-event-shapes.json`); this script is the real-data
 * counterpart and the place to look when a shape is missing from that fixture.
 *
 * Usage:
 *   cd apps/desktop
 *   bun scripts/feed-skeleton-parity-audit.mjs <sqlite-path> [--seeds 0.5,0.9] [--skip-orphans] [--verbose]
 *
 * Notes:
 *  - Copy the database first; the script only reads, but WAL files of a live app can move.
 *  - `--skip-orphans` ignores threads whose agent-scoped rows have no agent instance. Those
 *    rows are promoted to the main timeline by a rebuild only, which is a known rebuild-only
 *    content class (covered by shouldRebuildFeedSkeletonForOrphanAgentEvents), not a patch
 *    divergence.
 */
import { createConversationStore } from "../src/main/conversation-store.ts";
import {
  shouldRebuildFeedSkeletonForEmptyTimeline,
  shouldRebuildFeedSkeletonForOrphanAgentEvents,
  shouldRebuildFeedSkeletonForTruncatedUserPrompts,
} from "../src/main/thread-feed-skeleton-detectors.ts";
import {
  createThreadFeedSkeletonRecord,
  feedSkeletonTimelineIds,
  patchThreadFeedSkeletonFromEvent,
} from "../src/main/thread-feed-skeleton-patch.ts";
import { mapRunAttemptsForFeedSkeleton } from "../src/main/thread-feed-skeleton-store.ts";
import { isFeedMainTimelineEvent } from "../src/main/thread-feed-timeline-items.ts";
import { buildThreadRunProjection } from "../src/main/thread-run-projection.ts";
import { trimProjectionForFeed } from "../src/main/thread-run-projection-feed.ts";

const argv = process.argv.slice(2);
const dbPath = argv.find((arg) => !arg.startsWith("--"));
if (!dbPath) {
  console.error(
    "usage: bun scripts/feed-skeleton-parity-audit.mjs <sqlite-path> [--seeds 0.5,0.9] [--skip-orphans] [--verbose]",
  );
  process.exit(2);
}
const seedsArgument = argv.find((arg) => arg.startsWith("--seeds="))?.slice("--seeds=".length);
const seeds = (seedsArgument ?? "0.5,0.9")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0 && value < 1);
const skipOrphans = argv.includes("--skip-orphans");
const verbose = argv.includes("--verbose");

const ASSISTANT_EVENT_TYPES = new Set([
  "message.final",
  "message.delta",
  "thinking.final",
  "thinking.delta",
  "tool.started",
  "tool.completed",
]);

const store = await createConversationStore(dbPath);
// Only threads that actually have run events can exercise the patch path.
const threadIds = store
  .listThreads()
  .map((thread) => thread.threadId ?? thread.id)
  .filter((threadId) => store.getThreadRunEventMaxSequence(threadId) > 0);

function project(thread, events, attemptRecords, agents) {
  return trimProjectionForFeed(
    buildThreadRunProjection({
      threadId: thread.id,
      status: thread.status,
      message: thread.message,
      attempts: attemptRecords,
      agents,
      events,
      historyComplete: true,
    }),
  );
}

function hasOrphanAgentRows(threadId) {
  const known = new Set(store.listAgentInstances(threadId).map((agent) => agent.agentId));
  return store.listThreadRunEventsForProjection(threadId).some((event) => {
    if (event.scope !== "agent") return false;
    const agentId = event.agentId?.trim();
    if (!agentId || known.has(agentId)) return false;
    return ASSISTANT_EVENT_TYPES.has(event.eventType);
  });
}

let compared = 0;
let mismatched = 0;
let skippedOrphanThreads = 0;
let emptyFeeds = 0;
const detectorHits = [];
const mismatchTypes = new Map();

for (const threadId of threadIds) {
  const thread = store.getThread(threadId);
  if (!thread) continue;
  if (skipOrphans && hasOrphanAgentRows(threadId)) {
    skippedOrphanThreads += 1;
    continue;
  }
  const allEvents = store.listThreadRunEventsForProjection(threadId);
  if (allEvents.length === 0) continue;
  const attemptRecords = store.listRunAttempts(threadId);
  const agents = store.listAgentInstances(threadId);
  const attempts = mapRunAttemptsForFeedSkeleton(attemptRecords);
  const reference = project(thread, allEvents, attemptRecords, agents);
  const referenceIds = reference.timeline.map((item) => item.id);
  if (referenceIds.length === 0) {
    emptyFeeds += 1;
  }

  // A freshly rebuilt skeleton must not trigger the load-path detectors, otherwise every
  // projection emit rebuilds again.
  const orphan = shouldRebuildFeedSkeletonForOrphanAgentEvents({
    events: allEvents,
    timeline: reference.timeline,
    knownAgentIds: agents.map((agent) => agent.agentId),
  });
  if (orphan) {
    detectorHits.push(`${threadId}:orphan`);
  }
  if (
    shouldRebuildFeedSkeletonForEmptyTimeline(
      {
        timeline: reference.timeline,
        sourceEventCount: allEvents.length,
        hasFeedVisibleEvent: allEvents.some(isFeedMainTimelineEvent),
      },
      allEvents.length,
    )
  ) {
    detectorHits.push(`${threadId}:empty`);
  }
  if (shouldRebuildFeedSkeletonForTruncatedUserPrompts(reference.timeline)) {
    detectorHits.push(`${threadId}:truncated`);
  }

  for (const seedRatio of seeds) {
    const seedIndex = Math.max(1, Math.min(allEvents.length - 1, Math.floor(allEvents.length * seedRatio)));
    const seedSnapshot = project(thread, allEvents.slice(0, seedIndex), attemptRecords, agents);
    let record = createThreadFeedSkeletonRecord(
      seedSnapshot,
      { attempts, agents: [], historyRevision: 0, maxEventSequence: seedIndex },
      allEvents.slice(0, seedIndex),
    );
    for (const event of allEvents.slice(seedIndex)) {
      const patched = patchThreadFeedSkeletonFromEvent(record, event, {
        attempts,
        agents: [],
        historyRevision: 0,
        maxEventSequence: event.sequence,
      });
      if (!patched) {
        throw new Error(`patch returned null for ${threadId} ${event.id}`);
      }
      record = patched;
    }
    compared += 1;
    const patchedIds = feedSkeletonTimelineIds(record.snapshot);
    const same =
      patchedIds.length === referenceIds.length &&
      patchedIds.every((id, index) => id === referenceIds[index]);
    if (same) continue;
    mismatched += 1;
    const patchedSet = new Set(patchedIds);
    const referenceSet = new Set(referenceIds);
    const label = (prefix, item) => `${prefix}:${item.eventType}:${item.scope}:${item.role ?? "-"}`;
    if (verbose) {
      console.log(
        `MISMATCH ${threadId} seed=${seedRatio} patched=${patchedIds.length} reference=${referenceIds.length} events=${allEvents.length}`,
      );
    }
    for (const item of reference.timeline.filter((candidate) => !patchedSet.has(candidate.id)).slice(0, 5)) {
      if (verbose) console.log(`   missing ${item.eventType} scope=${item.scope} role=${item.role ?? "-"}`);
      mismatchTypes.set(label("missing", item), (mismatchTypes.get(label("missing", item)) ?? 0) + 1);
    }
    for (const item of record.snapshot.timeline
      .filter((candidate) => !referenceSet.has(candidate.id))
      .slice(0, 5)) {
      if (verbose) console.log(`   extra   ${item.eventType} scope=${item.scope} role=${item.role ?? "-"}`);
      mismatchTypes.set(label("extra", item), (mismatchTypes.get(label("extra", item)) ?? 0) + 1);
    }
  }
}

console.log(`database: ${dbPath}`);
console.log(`threads: ${threadIds.length} | replays: ${compared}`);
console.log(`mismatched: ${mismatched} | skipped orphan-agent threads: ${skippedOrphanThreads}`);
console.log(`empty feeds: ${emptyFeeds} | detector hits after rebuild: ${detectorHits.length}`);
if (detectorHits.length > 0) {
  console.log(`  ${detectorHits.slice(0, 10).join(", ")}${detectorHits.length > 10 ? ", …" : ""}`);
}
console.log(`mismatch types: ${JSON.stringify(Object.fromEntries(mismatchTypes))}`);

process.exit(mismatched > 0 || detectorHits.length > 0 ? 1 : 0);
