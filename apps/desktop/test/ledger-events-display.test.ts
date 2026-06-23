import { expect, test } from "bun:test";
import {
  partitionLedgerEventsForDisplay,
  resolveLedgerEventBillingRole,
  sumLedgerEventTokens,
} from "../src/shared/ledger-events-display";
import type { ThreadUsageLedgerEventView } from "../src/shared/ipc";

function makeEvent(
  overrides: Partial<ThreadUsageLedgerEventView> & Pick<ThreadUsageLedgerEventView, "id" | "source">,
): ThreadUsageLedgerEventView {
  return {
    role: "planner",
    routeRole: "planner",
    billingRole: "planner",
    attributionStatus: "attributed",
    inputTokens: 1000,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    observedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("partitionLedgerEventsForDisplay splits primary proxy from shadow sources", () => {
  const events = [
    makeEvent({ id: "p1", source: "proxy", inputTokens: 5000 }),
    makeEvent({ id: "s1", source: "sdk", inputTokens: 5000 }),
    makeEvent({ id: "s2", source: "sdk", inputTokens: 2000 }),
    makeEvent({ id: "p2", source: "proxy", inputTokens: 3000 }),
  ];
  const { primaryEvents, shadowEvents } = partitionLedgerEventsForDisplay(events, "proxy");
  expect(primaryEvents.map((event) => event.id)).toEqual(["p1", "p2"]);
  expect(shadowEvents.map((event) => event.id)).toEqual(["s1", "s2"]);
  expect(sumLedgerEventTokens(primaryEvents).total).toBe(8200);
});

test("resolveLedgerEventBillingRole prefers billingRole over routeRole", () => {
  expect(
    resolveLedgerEventBillingRole(
      makeEvent({
        id: "e1",
        source: "proxy",
        role: "coder",
        routeRole: "explore",
        billingRole: "coder",
      }),
    ),
  ).toBe("coder");
});
