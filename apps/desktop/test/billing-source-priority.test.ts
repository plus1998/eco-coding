import { expect, test } from "bun:test";
import {
  resolveBillingSourcePriority,
  resolveLedgerSourcePriority,
  selectPrimaryBillingSource,
} from "../src/main/billing-source-priority";

test("resolveBillingSourcePriority prefers proxy when proxy breakdown exists", () => {
  expect(resolveBillingSourcePriority({ sdk: {}, proxy: {} })).toEqual(["proxy", "sdk", "codex", "pi"]);
  expect(resolveBillingSourcePriority({ sdk: {} })).toEqual(["sdk", "proxy", "codex", "pi"]);
});

test("resolveBillingSourcePriority selects Codex as the authoritative source", () => {
  expect(resolveBillingSourcePriority({ codex: {} })).toEqual(["codex", "proxy", "sdk", "pi"]);
  expect(resolveBillingSourcePriority({ codex: {}, proxy: {}, sdk: {} })).toEqual([
    "codex",
    "proxy",
    "sdk",
    "pi",
  ]);
});

test("resolveBillingSourcePriority selects PI first when pi breakdown exists", () => {
  expect(resolveBillingSourcePriority({ pi: {}, proxy: {} })).toEqual(["pi", "proxy", "sdk", "codex"]);
});

test("resolveLedgerSourcePriority includes Codex and PI", () => {
  expect(resolveLedgerSourcePriority({ codex: {} })).toEqual(["codex", "proxy", "sdk", "pi"]);
  expect(resolveLedgerSourcePriority({ proxy: {} })).toEqual(["proxy", "sdk", "codex", "pi"]);
  expect(resolveLedgerSourcePriority({ pi: {} })).toEqual(["pi", "proxy", "sdk", "codex"]);
});

test("selectPrimaryBillingSource chooses proxy before sdk when both exist", () => {
  expect(
    selectPrimaryBillingSource({
      sdk: { source: "sdk" },
      proxy: { source: "proxy" },
    }),
  ).toBe("proxy");
});
