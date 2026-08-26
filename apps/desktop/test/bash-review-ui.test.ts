import { expect, test } from "bun:test";
import { confirmFullAccessBashReviewMode, normalizeBashReviewMode } from "../src/shared/bash-review-ui";

test("normalizeBashReviewMode accepts known modes and defaults otherwise", () => {
  expect(normalizeBashReviewMode("always")).toBe("always");
  expect(normalizeBashReviewMode("auto")).toBe("auto");
  expect(normalizeBashReviewMode("allow_all")).toBe("allow_all");
  expect(normalizeBashReviewMode("nope")).toBe("always");
  expect(normalizeBashReviewMode(undefined)).toBe("always");
});

test("confirmFullAccessBashReviewMode follows the confirm callback", () => {
  expect(confirmFullAccessBashReviewMode(() => true, "risk")).toBe(true);
  expect(confirmFullAccessBashReviewMode(() => false, "risk")).toBe(false);
});
