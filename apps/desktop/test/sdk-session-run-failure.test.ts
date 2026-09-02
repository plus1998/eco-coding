import { describe, expect, test } from "bun:test";
import {
  assertSdkSessionRetainedOnRunFailure,
  shouldClearSdkSessionOnRunFailure,
} from "../src/main/sdk-session-run-failure";

describe("shouldClearSdkSessionOnRunFailure", () => {
  test("keeps the SDK session after a mid-response API error on a resumed turn", () => {
    expect(
      shouldClearSdkSessionOnRunFailure({
        hadResume: true,
        reason: "API Error: Server error mid-response",
      }),
    ).toBe(false);
  });

  test("keeps the SDK session after other round failures", () => {
    expect(
      shouldClearSdkSessionOnRunFailure({
        hadResume: true,
        reason: "Connection failed",
      }),
    ).toBe(false);
    expect(
      shouldClearSdkSessionOnRunFailure({
        hadResume: false,
        reason: "API Error: Server error mid-response",
      }),
    ).toBe(false);
  });

  test("assertSdkSessionRetainedOnRunFailure does not throw for mid-response failures", () => {
    expect(() =>
      assertSdkSessionRetainedOnRunFailure({
        hadResume: true,
        reason: "API Error: Server error mid-response",
      }),
    ).not.toThrow();
  });

  test("planning and continuation onFailed keep the SDK session pointer", async () => {
    const source = await Bun.file(new URL("../src/main/index.ts", import.meta.url)).text();
    expect(source).not.toContain("clearSdkSessionAfterResumeFailure");
    expect(source).not.toContain("原 session 无法接续");
    expect(source).toContain("hadResume: Boolean(resumeOptsForRun)");
    expect(source).toContain("hadResume: Boolean(resumeOptsForContinuation)");

    const planningFailed = source.match(
      /onFailed: \(reason\) => \{\n {10}taskRunHooks\.stopIfUnhandled\("blocked"\);\n {10}cancelClarificationsForThread\(thread\.id, reason\);\n {10}assertSdkSessionRetainedOnRunFailure\(\{[\s\S]*?hadResume: Boolean\(resumeOptsForRun\),[\s\S]*?markThreadInterrupted\(thread\.id, reason\);\n {8}\}/,
    );
    const continuationFailed = source.match(
      /onFailed: \(reason\) => \{\n {10}taskRunHooks\?\.stopIfUnhandled\("blocked"\);\n {10}assertSdkSessionRetainedOnRunFailure\(\{[\s\S]*?hadResume: Boolean\(resumeOptsForContinuation\),[\s\S]*?markThreadInterrupted\(thread\.id, reason\);\n {8}\}/,
    );
    expect(planningFailed).not.toBeNull();
    expect(continuationFailed).not.toBeNull();
    expect(planningFailed?.[0]).not.toContain("clearSdkSession");
    expect(continuationFailed?.[0]).not.toContain("clearSdkSession");
  });
});
