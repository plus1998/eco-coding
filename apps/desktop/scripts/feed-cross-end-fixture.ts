/**
 * Writes the cross-end fixtures: what each corpus conversation looks like as a V2 bootstrap
 * payload, and the shape the Feed must render from it.
 *
 * The input half (`v2-bootstrap/<id>.json`) is the runtime's own bootstrap response, so
 * desktop and mobile are handed the *same* bytes — mobile receives this payload over RPC,
 * desktop reads it through the renderer store.
 *
 * The golden half (`v2-render/<id>.json`) is produced by the desktop renderer, which is the
 * reference implementation: its rows are already compared against the legacy chain on the
 * same corpus (`conversation-v2-real-corpus-parity.test.ts`), so the mobile renderer is
 * checked against something that is itself checked. Regenerating is a deliberate act:
 *
 *   bun apps/desktop/scripts/feed-cross-end-fixture.ts
 *
 * Every regeneration should be reviewed as a *rendering* change — if a golden row moved or
 * disappeared, say why in the commit message.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildConversationV2OnlyProjection } from "../src/renderer/ActivityLogView";
import { crossEndShape } from "../test/support/cross-end-shape";
import { feedShape } from "../test/support/feed-shape";
import { corpusBootstrap, loadCorpus } from "../test/support/v2-corpus";

function sortedBySeq<T>(rows: T[], seq: (row: T) => number): T[] {
  return [...rows].sort((left, right) => seq(left) - seq(right));
}

const fixturesDir = fileURLToPath(new URL("../test/fixtures/feed-parity/", import.meta.url));
const bootstrapDir = `${fixturesDir}v2-bootstrap/`;
const renderDir = `${fixturesDir}v2-render/`;
mkdirSync(bootstrapDir, { recursive: true });
mkdirSync(renderDir, { recursive: true });

const corpus = loadCorpus();
if (corpus.conversations.length === 0) {
  throw new Error("语料为空：先跑 bun apps/desktop/scripts/feed-corpus-fixture.mjs。");
}

for (const conversation of corpus.conversations) {
  const { bootstrap, session } = corpusBootstrap(conversation);
  const shape = crossEndShape(
    feedShape(
      buildConversationV2OnlyProjection(session, {
        createdAt: String(conversation.thread.created_at),
        status: "completed",
      }),
    ),
  );
  // The client's read, flattened into one payload: the runtime answers a bootstrap with the
  // newest window and a cursor, and the client follows the cursor until it holds the whole
  // conversation (`loadConversationV2OlderHistory` in `App.tsx`). Storing only the first
  // window would hand both ends an input neither of them renders in the app — the Feed would
  // be missing the older turns of every long conversation in the fixture.
  const flattened = {
    ...bootstrap,
    messages: sortedBySeq([...session.messages.values()], (message) => message.createdSeq),
    runs: [...session.runs.values()],
    tools: [...session.tools.values()],
    agents: [...session.agents.values()],
    hasOlder: false,
  };
  delete (flattened as { olderCursor?: string }).olderCursor;
  writeFileSync(
    `${bootstrapDir}${conversation.conversationId}.json`,
    `${JSON.stringify(flattened, null, 2)}\n`,
  );
  writeFileSync(`${renderDir}${conversation.conversationId}.json`, `${JSON.stringify(shape, null, 2)}\n`);
  console.log(
    `${conversation.conversationId}: feed ${shape.feed.length} 行 / 卡片 ${shape.cards.length} 张 / attempts ${shape.attempts.length}`,
  );
}
