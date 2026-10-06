import { expect, test } from "bun:test";
import {
  evaluateSdkRoundFixture,
  loadSdkRoundFixture,
  replaySdkRoundFixture,
} from "./helpers/sdk-round-replay";

test("PI SDK round fixture passes scenario checklist", () => {
  const fixture = loadSdkRoundFixture("pi");
  const evaluation = evaluateSdkRoundFixture(fixture);
  expect(evaluation.ok, evaluation.failed.join(", ")).toBe(true);
});

test("PI SDK raw events replay to agent events with scenario coverage", () => {
  const fixture = loadSdkRoundFixture("pi");
  const result = replaySdkRoundFixture(fixture);
  expect(result.replayedAgentEvents.length).toBeGreaterThan(10);
  expect(result.checklist.ok, result.checklist.failed.join(", ")).toBe(true);
  expect(result.replayedAgentEvents.some((event) => event.type === "tool.started")).toBe(true);
});

test("Claude SDK round fixture passes scenario checklist", () => {
  const fixture = loadSdkRoundFixture("claude");
  const evaluation = evaluateSdkRoundFixture(fixture);
  expect(evaluation.ok, evaluation.failed.join(", ")).toBe(true);
});

test("Claude SDK messages replay to agent events with scenario coverage", () => {
  const fixture = loadSdkRoundFixture("claude");
  const result = replaySdkRoundFixture(fixture);
  expect(result.replayedAgentEvents.length).toBeGreaterThan(10);
  expect(result.checklist.ok, result.checklist.failed.join(", ")).toBe(true);
  expect(result.replayedAgentEvents.some((event) => event.type === "message.delta")).toBe(true);
});
