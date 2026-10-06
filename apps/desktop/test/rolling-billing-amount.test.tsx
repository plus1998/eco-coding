import { expect, test } from "bun:test";
import { billingDigitOffsetPercent, shouldRollBillingAmount, splitBillingAmount } from "../src/renderer/RollingBillingAmount";

test("splits currency strings into stable digit slots and static characters", () => {
  expect(splitBillingAmount("$1,234.5000")).toEqual([
    { kind: "static", key: "static-0", value: "$" },
    { kind: "digit", key: "digit-0", value: "1", digit: { key: "digit-0", value: 1 } },
    { kind: "static", key: "static-2", value: "," },
    ...[2, 3, 4].map((value, index) => ({
      kind: "digit" as const,
      key: `digit-${index + 1}`,
      value: String(value),
      digit: { key: `digit-${index + 1}`, value },
    })),
    { kind: "static", key: "static-6", value: "." },
    ...[5, 0, 0, 0].map((value, index) => ({
      kind: "digit" as const,
      key: `digit-${index + 4}`,
      value: String(value),
      digit: { key: `digit-${index + 4}`, value },
    })),
  ]);
  expect(splitBillingAmount("$0").map(({ value }) => value)).toEqual(["$", "0"]);
});

test("maps each digit to its position in the fixed 0-9 reel", () => {
  expect(billingDigitOffsetPercent(0)).toBe(-0);
  expect(billingDigitOffsetPercent(5)).toBe(-50);
  expect(billingDigitOffsetPercent(9)).toBe(-90);
});

test("only rolls increasing values within the same session when formatted text changes", () => {
  expect(shouldRollBillingAmount(1.239, 1.241, "$1.24", "$1.25", true)).toBe(true);
  expect(shouldRollBillingAmount(1.239, 1.2391, "$1.24", "$1.24", true)).toBe(false);
  expect(shouldRollBillingAmount(1.25, 1.2, "$1.25", "$1.20", true)).toBe(false);
  expect(shouldRollBillingAmount(9.99, 10, "$9.99", "$10.00", true)).toBe(true);
  expect(shouldRollBillingAmount(undefined, 0.01, undefined, "$0.01", false)).toBe(false);
  expect(shouldRollBillingAmount(1, 2, "$1", "$2", false)).toBe(false);
});
