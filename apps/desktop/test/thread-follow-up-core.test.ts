import { expect, test } from "bun:test";
import {
  coreSupportsFollowUpEscalate,
  coreSupportsMidTurnFollowUp,
  coreUsesInterruptForSteer,
  resolveFollowUpDeliveryModeForCore,
} from "../src/shared/thread-follow-up-core";

test("coreSupportsMidTurnFollowUp is only Claude and Codex", () => {
  expect(coreSupportsMidTurnFollowUp("claude")).toBe(true);
  expect(coreSupportsMidTurnFollowUp("codex")).toBe(true);
  expect(coreSupportsMidTurnFollowUp("acp")).toBe(false);
  expect(coreSupportsMidTurnFollowUp("pi")).toBe(false);
  expect(coreSupportsMidTurnFollowUp(undefined)).toBe(false);
});

test("ACP follow-up escalate and steer use interrupt, not mid-turn", () => {
  expect(coreSupportsFollowUpEscalate("acp")).toBe(true);
  expect(coreSupportsFollowUpEscalate("claude")).toBe(true);
  expect(coreSupportsFollowUpEscalate("pi")).toBe(false);
  expect(coreUsesInterruptForSteer("acp")).toBe(true);
  expect(coreUsesInterruptForSteer("claude")).toBe(false);
  expect(coreUsesInterruptForSteer("codex")).toBe(false);
  expect(resolveFollowUpDeliveryModeForCore("acp", "steer")).toBe("steer");
  expect(resolveFollowUpDeliveryModeForCore("acp", "queue")).toBe("queue");
  expect(resolveFollowUpDeliveryModeForCore("claude", "steer")).toBe("steer");
  expect(resolveFollowUpDeliveryModeForCore("pi", "steer")).toBe("queue");
});
