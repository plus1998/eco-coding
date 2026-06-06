import { expect, test } from "bun:test";
import {
  DEFAULT_BILLING_SNAPSHOT_SELECTION_POLICY,
  resolveBillingSnapshotSelectionOptions,
} from "../src/main/billing-snapshot-selection-policy";

test("default billing snapshot policy enables verified ledger projection", () => {
  expect(DEFAULT_BILLING_SNAPSHOT_SELECTION_POLICY).toEqual({
    useLedgerProjection: true,
  });
  expect(resolveBillingSnapshotSelectionOptions()).toEqual({
    useLedgerProjection: true,
  });
});

test("billing snapshot policy can disable ledger projection and keep planner label", () => {
  expect(
    resolveBillingSnapshotSelectionOptions({
      policy: { useLedgerProjection: false },
      plannerModelLabel: "Claude Sonnet",
    }),
  ).toEqual({
    useLedgerProjection: false,
    plannerModelLabel: "Claude Sonnet",
  });
});
