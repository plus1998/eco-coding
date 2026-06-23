import { expect, test } from "bun:test";
import {
  resolveBillingSourcePriority,
  selectPrimaryBillingSource,
} from "../src/main/billing-source-priority";

test("resolveBillingSourcePriority prefers proxy when proxy breakdown exists", () => {
  expect(resolveBillingSourcePriority({ sdk: {}, proxy: {} })).toEqual(["proxy", "sdk"]);
  expect(resolveBillingSourcePriority({ sdk: {} })).toEqual(["sdk", "proxy"]);
});

test("selectPrimaryBillingSource chooses proxy before sdk when both exist", () => {
  expect(
    selectPrimaryBillingSource({
      sdk: { source: "sdk" },
      proxy: { source: "proxy" },
    }),
  ).toBe("proxy");
});
