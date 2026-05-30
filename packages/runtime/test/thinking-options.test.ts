import { expect, test } from "bun:test";
import {
  applyThinkingToMessagesBody,
  applyThinkingToQueryOptions,
  buildThinkingQueryPatch,
} from "../src/thinking-options";

test("buildThinkingQueryPatch off disables thinking", () => {
  expect(buildThinkingQueryPatch("off")).toEqual({ thinking: { type: "disabled" } });
});

test("buildThinkingQueryPatch xhigh enables adaptive thinking", () => {
  expect(buildThinkingQueryPatch("xhigh")).toEqual({
    effort: "xhigh",
    thinking: { type: "adaptive" },
    effortLevel: "xhigh",
    claudeCodeEffortLevel: "xhigh",
  });
});

test("applyThinkingToQueryOptions merges settings", () => {
  const options: Record<string, unknown> = { settings: { env: { FOO: "bar" } } };
  applyThinkingToQueryOptions(options, "high");
  expect(options.effort).toBe("high");
  expect(options.thinking).toEqual({ type: "adaptive" });
  expect((options.settings as Record<string, unknown>).effortLevel).toBe("high");
});

test("applyThinkingToMessagesBody skips when already set", () => {
  const body = { effort: "low", thinking: { type: "adaptive" } };
  applyThinkingToMessagesBody(body, "max");
  expect(body.effort).toBe("low");
});

test("applyThinkingToMessagesBody injects effort", () => {
  const body: Record<string, unknown> = {};
  applyThinkingToMessagesBody(body, "xhigh");
  expect(body.effort).toBe("xhigh");
  expect(body.thinking).toEqual({ type: "adaptive" });
});
