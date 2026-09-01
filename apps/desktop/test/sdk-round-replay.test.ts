import { expect, test } from "bun:test";
import {
  evaluateSdkRoundFixture,
  loadSdkRoundFixture,
  replaySdkRoundFixture,
  resolveSdkRoundFixtureDir,
} from "./helpers/sdk-round-replay";

function hasPiFixture(): boolean {
  try {
    resolveSdkRoundFixtureDir("pi");
    return true;
  } catch {
    return false;
  }
}

function hasClaudeFixture(): boolean {
  try {
    resolveSdkRoundFixtureDir("claude");
    return true;
  } catch {
    return false;
  }
}

test.skipIf(!hasPiFixture())("PI SDK round fixture passes scenario checklist", () => {
  const fixture = loadSdkRoundFixture("pi");
  const evaluation = evaluateSdkRoundFixture(fixture);
  expect(evaluation.ok, evaluation.failed.join(", ")).toBe(true);
});

test.skipIf(!hasPiFixture())("PI SDK raw events replay to agent events with scenario coverage", () => {
  const fixture = loadSdkRoundFixture("pi");
  const result = replaySdkRoundFixture(fixture);
  expect(result.replayedAgentEvents.length).toBeGreaterThan(10);
  expect(result.checklist.ok, result.checklist.failed.join(", ")).toBe(true);
  expect(result.replayedAgentEvents.some((event) => event.type === "tool.started")).toBe(true);
});

test.skipIf(!hasClaudeFixture())("Claude SDK round fixture passes scenario checklist", () => {
  const fixture = loadSdkRoundFixture("claude");
  const evaluation = evaluateSdkRoundFixture(fixture);
  expect(evaluation.ok, evaluation.failed.join(", ")).toBe(true);
});

test.skipIf(!hasClaudeFixture())("Claude SDK messages replay to agent events with scenario coverage", () => {
  const fixture = loadSdkRoundFixture("claude");
  const result = replaySdkRoundFixture(fixture);
  expect(result.replayedAgentEvents.length).toBeGreaterThan(10);
  expect(result.checklist.ok, result.checklist.failed.join(", ")).toBe(true);
  expect(result.replayedAgentEvents.some((event) => event.type === "message.delta")).toBe(true);
});
