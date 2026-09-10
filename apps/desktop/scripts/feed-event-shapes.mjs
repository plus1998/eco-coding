/**
 * Regenerates `test/fixtures/feed-parity/observed-event-shapes.json`.
 *
 * The fixture records the *shape* of every persisted run event that has ever been written to
 * a local Eco database — event type, scope, role, stream state, flags, and the metadata key
 * names with their value types — plus how often each shape occurs and a few thread-level
 * properties the parity tests rely on. Message text and ids are never stored, so the file is
 * safe to commit; the parity tests use it as the shape space to fuzz over.
 *
 * Re-run this after the event writer changes, or when a new shape shows up in the logs
 * (the parity tests assert that every shape in the fixture is exercised).
 *
 * Usage:
 *   cd apps/desktop
 *   bun scripts/feed-event-shapes.mjs [sqlite-path ...] [--labels dev,prod]
 *
 * Defaults to the local dev + production databases. Copy live databases first.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConversationStore } from "../src/main/conversation-store.ts";

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const databasePaths =
  positional.length > 0
    ? positional
    : [
        path.join(os.homedir(), "Library/Application Support/@eco/desktopDev/eco-coding.sqlite"),
        path.join(os.homedir(), "Library/Application Support/@eco/desktop/eco-coding.sqlite"),
      ];

const outputPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../test/fixtures/feed-parity/observed-event-shapes.json",
);

const labelArgument = process.argv.find((arg) => arg.startsWith("--labels="));
const labels = (labelArgument?.slice("--labels=".length) ?? "").split(",").map((label) => label.trim());

const ENUM_METADATA_KEYS = new Set(["liveType", "streamState", "phase", "status", "kind", "role"]);

function valueTypeOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  if (typeof value === "object") return "object";
  return typeof value;
}

/** Metadata reduced to key names + value types, plus the `liveType` value (an enum). */
function metadataShape(metadata) {
  if (!metadata || typeof metadata !== "object") return undefined;
  const entries = Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return undefined;
  const keys = entries.map(([key, value]) => `${key}:${valueTypeOf(value)}`).join(",");
  const liveType = metadata.liveType;
  return { keys, ...(typeof liveType === "string" ? { liveType } : {}) };
}

function shapeOf(event) {
  const metadata = metadataShape(event.metadata);
  return {
    eventType: event.eventType,
    scope: event.scope,
    ...(event.role ? { role: event.role } : {}),
    textEmpty: !String(event.message ?? "").trim(),
    streamState: event.streamState ?? null,
    hasStreamKey: Boolean(event.streamKey),
    hasRunAttemptId: Boolean(event.runAttemptId),
    hasRequestId: Boolean(event.requestId),
    hasAgentId: Boolean(event.agentId),
    hasParentToolUseId: Boolean(event.parentToolUseId),
    ...(metadata ? { metadata } : {}),
  };
}

const shapes = new Map();
const threadTraits = new Map();
// The store collapses stream deltas by identity alone (no scope in the key), so an identity
// spanning two scopes would let an agent row supersede a main row. Real data has none; the
// test generator relies on that, so record the count in the fixture.
const streamIdentityScopes = new Map();

for (const [index, databasePath] of databasePaths.entries()) {
  if (!fs.existsSync(databasePath)) {
    console.warn(`skip (missing): ${databasePath}`);
    continue;
  }
  // Labels only annotate which database a shape was seen in; default to the file name.
  const label = labels[index] ?? path.basename(databasePath, path.extname(databasePath));
  const store = await createConversationStore(databasePath);
  for (const thread of store.listThreads()) {
    const threadId = thread.threadId ?? thread.id;
    const events = store.listThreadRunEventsForProjection(threadId);
    if (events.length === 0) continue;
    const knownAgents = new Set(store.listAgentInstances(threadId).map((agent) => agent.agentId));
    const attempts = store.listRunAttempts(threadId);
    let agentRows = 0;
    let orphanAgentRows = 0;
    const deltaIdentities = new Map();
    for (const event of events) {
      const shape = shapeOf(event);
      const key = JSON.stringify(shape);
      const entry = shapes.get(key) ?? { shape, count: 0, databases: new Set() };
      entry.count += 1;
      entry.databases.add(label);
      shapes.set(key, entry);

      if (event.scope === "agent") {
        agentRows += 1;
        if (event.agentId?.trim() && !knownAgents.has(event.agentId.trim())) {
          orphanAgentRows += 1;
        }
      }
      if (
        (event.eventType === "message.delta" || event.eventType === "thinking.delta") &&
        event.streamKey
      ) {
        deltaIdentities.set(
          [event.eventType, event.streamKey, event.requestId ?? "", event.runAttemptId ?? ""].join("\0"),
          event.scope,
        );
      }
    }
    for (const [identity, scope] of deltaIdentities) {
      const owners = streamIdentityScopes.get(identity) ?? new Set();
      owners.add(scope);
      streamIdentityScopes.set(identity, owners);
    }
    threadTraits.set(threadId, {
      events: events.length,
      agentRows,
      orphanAgentRows,
      attemptStatuses: [...new Set(attempts.map((attempt) => attempt.status))].sort(),
    });
  }
}

if (shapes.size === 0) {
  console.error("no run events found in the given databases");
  process.exit(1);
}

const traits = [...threadTraits.values()];
const fixture = {
  generatedFrom: "local dev + prod thread_run_events (shape keys only, no text/ids)",
  generatedBy: "apps/desktop/scripts/feed-event-shapes.mjs",
  threadCount: threadTraits.size,
  threadsWithOrphanAgentRows: traits.filter((trait) => trait.orphanAgentRows > 0).length,
  attemptStatusSets: [...new Set(traits.map((trait) => trait.attemptStatuses.join("+")))].sort(),
  maxEventsPerThread: Math.max(...traits.map((trait) => trait.events).concat([0])),
  crossScopeStreamIdentities: [...streamIdentityScopes.values()].filter((scopes) => scopes.size > 1)
    .length,
  shapes: [...shapes.values()]
    .sort((left, right) => right.count - left.count)
    .map((entry) => ({
      ...entry.shape,
      count: entry.count,
      databases: [...entry.databases].sort(),
    })),
};

fs.writeFileSync(outputPath, `${JSON.stringify(fixture, null, 1)}\n`);
console.log(
  `wrote ${fixture.shapes.length} shapes from ${fixture.threadCount} threads -> ${path.relative(process.cwd(), outputPath)}`,
);
