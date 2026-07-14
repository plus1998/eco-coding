import { expect, test } from "bun:test";
import {
  resolveBillingSourcePriority,
  resolveLedgerSourcePriority,
  selectPrimaryBillingSource,
} from "../src/main/billing-source-priority";

test("resolveBillingSourcePriority prefers proxy when proxy breakdown exists", () => {
  expect(resolveBillingSourcePriority({ sdk: {}, proxy: {} })).toEqual(["proxy", "sdk", "codex"]);
  expect(resolveBillingSourcePriority({ sdk: {} })).toEqual(["sdk", "proxy", "codex"]);
});

test("resolveBillingSourcePriority selects Codex as the authoritative source", () => {
  expect(resolveBillingSourcePriority({ codex: {} })).toEqual(["codex", "proxy", "sdk"]);
  expect(resolveBillingSourcePriority({ codex: {}, proxy: {}, sdk: {} })).toEqual([
    "codex",
    "proxy",
    "sdk",
  ]);
});

test("resolveLedgerSourcePriority includes Codex in persisted billing projection", () => {
  expect(resolveLedgerSourcePriority({ codex: {} })).toEqual(["codex", "proxy", "sdk"]);
  expect(resolveLedgerSourcePriority({ proxy: {} })).toEqual(["proxy", "sdk", "codex"]);
});

test("selectPrimaryBillingSource chooses proxy before sdk when both exist", () => {
  expect(
    selectPrimaryBillingSource({
      sdk: { source: "sdk" },
      proxy: { source: "proxy" },
    }),
  ).toBe("proxy");
});
