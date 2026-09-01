#!/usr/bin/env bun
/**
 * Build expected/ artifacts for a conversation round fixture.
 *
 *   bun scripts/conversation-round/build-expected.ts
 *   bun scripts/conversation-round/build-expected.ts --fixture=<runId>
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConversationRoundFixture,
  resolveConversationRoundFixtureDir,
} from "../../apps/desktop/test/helpers/conversation-round-fixture.ts";
import {
  replayConversationRound,
  writeConversationRoundExpected,
} from "../../apps/desktop/test/helpers/conversation-round-replay.ts";

const args = process.argv.slice(2);
const fixtureArg = args.find((arg) => arg.startsWith("--fixture="))?.slice("--fixture=".length);

const fixtureDir = resolveConversationRoundFixtureDir(fixtureArg);
const fixture = loadConversationRoundFixture(fixtureDir);
const result = await replayConversationRound({ fixture });
writeConversationRoundExpected(fixtureDir, result);

console.log(
  JSON.stringify(
    {
      ok: true,
      fixtureDir,
      runId: fixture.runId,
      marker: fixture.marker,
      eventCount: result.persistedEvents.length,
      feedTimelineIds: result.feedTimelineIds,
      scenarioSignals: result.scenarioSignals,
      expectedDir: path.join(fixtureDir, "expected"),
    },
    null,
    2,
  ),
);
