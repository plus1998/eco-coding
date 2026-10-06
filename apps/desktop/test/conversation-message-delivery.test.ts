import { expect, test } from "bun:test";
import {
  scheduledAcceptedMessageDelivery,
  terminalAcceptedMessageDelivery,
} from "../src/shared/conversation-message-delivery";

test("only final messages confirm delivery; failed and deleted acceptances stay unconfirmed", () => {
  expect(terminalAcceptedMessageDelivery({ status: "final", isDeleted: false })).toEqual({
    state: "delivered",
  });
  for (const status of ["failed", "cancelled", "deleted"] as const) {
    expect(terminalAcceptedMessageDelivery({ status, isDeleted: false })?.state).toBe("unknown");
  }
  expect(terminalAcceptedMessageDelivery({ status: "final", isDeleted: true })?.state).toBe("unknown");
  expect(terminalAcceptedMessageDelivery(undefined)?.state).toBe("unknown");
  expect(terminalAcceptedMessageDelivery({ status: "queued", isDeleted: false })).toBeUndefined();
  expect(terminalAcceptedMessageDelivery({ status: "final", isDeleted: false }, true)?.state).toBe("unknown");
  expect(
    terminalAcceptedMessageDelivery(
      {
        status: "final",
        isDeleted: false,
        historyTarget: { activityLineId: "sdk:message-1", userMessageId: "message-1" },
      },
      true,
    )?.state,
  ).toBe("delivered");
});

test("new dispatch waits for its provider receipt but never hides an immediate failure as queued", () => {
  expect(scheduledAcceptedMessageDelivery({ status: "final", isDeleted: false }, true).state).toBe("queued");
  expect(scheduledAcceptedMessageDelivery({ status: "queued", isDeleted: false }, true).state).toBe("queued");
  for (const status of ["failed", "cancelled", "deleted"] as const) {
    expect(scheduledAcceptedMessageDelivery({ status, isDeleted: false }, true).state).toBe("unknown");
  }
  expect(scheduledAcceptedMessageDelivery(undefined, true).state).toBe("unknown");
});
