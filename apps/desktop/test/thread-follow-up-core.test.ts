import { expect, test } from "bun:test";
import { expectedIpcErrorKey } from "../src/shared/i18n-catalogs";
import {
  ACP_FOLLOW_UP_ATTACHMENTS_UNSUPPORTED,
  ACP_FOLLOW_UP_ESCALATE_UNSUPPORTED,
  assertAcpFollowUpEscalateAllowed,
  assertAcpFollowUpTextOnly,
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

test("ACP enqueue plan forces queue and rejects attachments", () => {
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
  ).toEqual({ kind: "reject_attachments" });
});

test("ACP follow-up attachments and escalate throw explicit errors", () => {
  expect(() =>
    assertAcpFollowUpTextOnly({ coreKind: "acp", attachmentCount: 1 }),
  ).toThrow(ACP_FOLLOW_UP_ATTACHMENTS_UNSUPPORTED);
  expect(() => assertAcpFollowUpTextOnly({ coreKind: "acp", attachmentCount: 0 })).not.toThrow();
  expect(() =>
    assertAcpFollowUpTextOnly({ coreKind: "claude", attachmentCount: 1 }),
  ).not.toThrow();
  expect(() => assertAcpFollowUpEscalateAllowed("acp")).toThrow(ACP_FOLLOW_UP_ESCALATE_UNSUPPORTED);
  expect(() => assertAcpFollowUpEscalateAllowed("claude")).not.toThrow();
  expect(expectedIpcErrorKey(ACP_FOLLOW_UP_ATTACHMENTS_UNSUPPORTED)).toBe(
    "native.acpFollowUpAttachmentsUnsupported",
  );
  expect(expectedIpcErrorKey(ACP_FOLLOW_UP_ESCALATE_UNSUPPORTED)).toBe(
    "native.acpFollowUpEscalateUnsupported",
  );
});
