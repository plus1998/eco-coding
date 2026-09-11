import { expect, test } from "bun:test";
import {
  coreSupportsFollowUpEscalate,
  coreSupportsMidTurnFollowUp,
  coreUsesInterruptForSteer,
  resolveFollowUpDeliveryModeForCore,
} from "../src/shared/thread-follow-up-core";

test("coreSupportsMidTurnFollowUp is Claude, Codex and PI", () => {
  expect(coreSupportsMidTurnFollowUp("claude")).toBe(true);
  expect(coreSupportsMidTurnFollowUp("codex")).toBe(true);
  expect(coreSupportsMidTurnFollowUp("acp")).toBe(false);
  expect(coreSupportsMidTurnFollowUp("pi")).toBe(true);
  expect(coreSupportsMidTurnFollowUp(undefined)).toBe(false);
});

test("ACP follow-up steer uses interrupt; Claude/Codex/PI keep mid-turn steer", () => {
  expect(coreSupportsFollowUpEscalate("acp")).toBe(true);
  expect(coreSupportsFollowUpEscalate("claude")).toBe(true);
  expect(coreSupportsFollowUpEscalate("codex")).toBe(true);
  expect(coreSupportsFollowUpEscalate("pi")).toBe(true);
  expect(coreSupportsFollowUpEscalate(undefined)).toBe(false);
  expect(coreUsesInterruptForSteer("acp")).toBe(true);
  expect(coreUsesInterruptForSteer("claude")).toBe(false);
  expect(coreUsesInterruptForSteer("codex")).toBe(false);
  expect(coreUsesInterruptForSteer("pi")).toBe(false);
  expect(resolveFollowUpDeliveryModeForCore("acp", "steer")).toBe("steer");
  expect(resolveFollowUpDeliveryModeForCore("acp", "queue")).toBe("queue");
  expect(resolveFollowUpDeliveryModeForCore("claude", "steer")).toBe("steer");
  expect(resolveFollowUpDeliveryModeForCore("codex", "steer")).toBe("steer");
  expect(resolveFollowUpDeliveryModeForCore("pi", "steer")).toBe("steer");
  expect(resolveFollowUpDeliveryModeForCore("pi", "queue")).toBe("queue");
  expect(resolveFollowUpDeliveryModeForCore(undefined, "steer")).toBe("queue");
});
