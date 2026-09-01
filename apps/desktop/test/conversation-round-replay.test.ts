import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateFixtureScenarioChecklist,
  loadConversationRoundFixture,
  resolveConversationRoundFixtureDir,
} from "./helpers/conversation-round-fixture";
import { replayConversationRound } from "./helpers/conversation-round-replay";

const fixtureDir = resolveConversationRoundFixtureDir();

test("conversation round fixture passes upstream scenario checklist", () => {
  const fixture = loadConversationRoundFixture(fixtureDir);
  const evaluation = evaluateFixtureScenarioChecklist(fixture);
  expect(evaluation.ok, evaluation.failed.join(", ")).toBe(true);
});

test("conversation round replay projects Codex notifications to thread run events", async () => {
  const result = await replayConversationRound({ fixtureDir });
  expect(result.replayedEvents.length).toBeGreaterThan(10);
  expect(result.persistedEvents.length).toBe(result.replayedEvents.length);
  expect(result.persistedEvents.some((event) => event.eventType === "message.final")).toBe(true);
  expect(result.persistedEvents.some((event) => event.eventType === "tool.started")).toBe(true);
});

test("conversation round replay covers MCP, skills, files, and subagent signals", async () => {
  const result = await replayConversationRound({ fixtureDir });
  const { scenarioSignals } = result;

  expect(scenarioSignals.userPrompts).toBeGreaterThan(0);
  expect(scenarioSignals.assistantFinals).toBeGreaterThan(0);
  expect(scenarioSignals.mcpTools).toBeGreaterThan(0);
  expect(scenarioSignals.fileCommands).toBeGreaterThan(0);
  expect(scenarioSignals.subagentStarts).toBeGreaterThan(0);
  expect(scenarioSignals.skillMentioned).toBe(true);
  expect(scenarioSignals.markerInFinal).toBe(true);
  expect(result.tokenUsageUpdates).toBeGreaterThan(0);
});

test("conversation round replay closes subagent lifecycle on child turn/completed", async () => {
  const result = await replayConversationRound({ fixtureDir });
  expect(result.scenarioSignals.subagentStarts).toBeGreaterThan(0);
  expect(result.scenarioSignals.subagentStops).toBeGreaterThan(0);
  expect(result.agents.some((agent) => agent.kind === "subagent" && agent.status === "stopped")).toBe(true);
});

test("conversation round replay uses monotonic rpc-log timestamps", async () => {
  const result = await replayConversationRound({ fixtureDir });
  const observedAts = result.persistedEvents.map((event) => event.observedAt);
  expect(new Set(observedAts).size).toBeGreaterThan(10);
  for (let index = 1; index < observedAts.length; index += 1) {
    expect(observedAts[index]?.localeCompare(observedAts[index - 1] ?? "")).toBeGreaterThanOrEqual(0);
  }
});

test("conversation round incremental feed skeleton matches full rebuild", async () => {
  const result = await replayConversationRound({ fixtureDir });
  expect(result.feedTimelineIds.length).toBeGreaterThan(0);
  expect(result.feedTimelineIds).toEqual(result.referenceFeedTimelineIds);
});

test("conversation round expected artifacts stay aligned when present", async () => {
  const result = await replayConversationRound({ fixtureDir });
  const expectedDir = path.join(fixtureDir, "expected");
  const feedIdsPath = path.join(expectedDir, "feed-timeline-ids.json");
  if (!fs.existsSync(feedIdsPath)) {
    return;
  }
  const expectedFeedIds = JSON.parse(fs.readFileSync(feedIdsPath, "utf8")) as string[];
  expect(result.feedTimelineIds).toEqual(expectedFeedIds);
});
