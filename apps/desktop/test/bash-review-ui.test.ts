import { expect, test } from "bun:test";
import {
  confirmFullAccessBashReviewMode,
  didSwitchToAllowAllBashReviewMode,
  normalizeBashReviewMode,
} from "../src/shared/bash-review-ui";

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

test("didSwitchToAllowAllBashReviewMode detects only transitions into allow_all", () => {
  expect(didSwitchToAllowAllBashReviewMode("always", "allow_all")).toBe(true);
  expect(didSwitchToAllowAllBashReviewMode("auto", "allow_all")).toBe(true);
  expect(didSwitchToAllowAllBashReviewMode(undefined, "allow_all")).toBe(true);
  expect(didSwitchToAllowAllBashReviewMode("allow_all", "allow_all")).toBe(false);
  expect(didSwitchToAllowAllBashReviewMode("allow_all", "auto")).toBe(false);
  expect(didSwitchToAllowAllBashReviewMode("always", "auto")).toBe(false);
});
