import { expect, test } from "bun:test";
import { expectedIpcErrorKey } from "../src/shared/i18n-catalogs";
import {
  ACP_FOLLOW_UP_ESCALATE_UNSUPPORTED,
  assertAcpFollowUpEscalateAllowed,
  coreSupportsFollowUpEscalate,
  coreSupportsMidTurnFollowUp,
  resolveAcpFollowUpEnqueuePlan,
  resolveFollowUpDeliveryModeForCore,
  shouldForceQueuedFollowUp,
} from "../src/shared/thread-follow-up-core";

test("coreSupportsMidTurnFollowUp is only Claude and Codex", () => {
  expect(coreSupportsMidTurnFollowUp("claude")).toBe(true);
  expect(coreSupportsMidTurnFollowUp("codex")).toBe(true);
  expect(coreSupportsMidTurnFollowUp("acp")).toBe(false);
  expect(coreSupportsMidTurnFollowUp("pi")).toBe(false);
  expect(coreSupportsMidTurnFollowUp(undefined)).toBe(false);
});

test("ACP follow-up cannot escalate or steer", () => {
  expect(coreSupportsFollowUpEscalate("acp")).toBe(false);
  expect(coreSupportsFollowUpEscalate("claude")).toBe(true);
  expect(shouldForceQueuedFollowUp("acp")).toBe(true);
  expect(shouldForceQueuedFollowUp("claude")).toBe(false);
  expect(resolveFollowUpDeliveryModeForCore("acp", "steer")).toBe("queue");
  expect(resolveFollowUpDeliveryModeForCore("acp", "queue")).toBe("queue");
  expect(resolveFollowUpDeliveryModeForCore("claude", "steer")).toBe("steer");
});

test("ACP enqueue plan force-queues text and attachments", () => {
  expect(resolveAcpFollowUpEnqueuePlan({ coreKind: "claude", attachmentCount: 0 })).toEqual({
    kind: "default",
  });
  expect(resolveAcpFollowUpEnqueuePlan({ coreKind: "acp", attachmentCount: 0 })).toEqual({
    kind: "force_queue",
  });
  expect(
    resolveAcpFollowUpEnqueuePlan({
      coreKind: "acp",
      attachmentCount: 1,
    }),
  ).toEqual({ kind: "force_queue" });
});

test("ACP follow-up escalate still throws; attachments no longer throw at enqueue", () => {
  expect(() => assertAcpFollowUpEscalateAllowed("acp")).toThrow(ACP_FOLLOW_UP_ESCALATE_UNSUPPORTED);
  expect(() => assertAcpFollowUpEscalateAllowed("claude")).not.toThrow();
  expect(expectedIpcErrorKey(ACP_FOLLOW_UP_ESCALATE_UNSUPPORTED)).toBe(
    "native.acpFollowUpEscalateUnsupported",
  );
});
