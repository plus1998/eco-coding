import { expect, test } from "bun:test";
import { coreSupportsPlanAskModes, resolveSessionModeForCore } from "../src/shared/acp-session-mode";

test("coreSupportsPlanAskModes includes acp", () => {
  expect(coreSupportsPlanAskModes("acp")).toBe(true);
  expect(coreSupportsPlanAskModes("claude")).toBe(true);
  expect(coreSupportsPlanAskModes(undefined)).toBe(false);
});

test("resolveSessionModeForCore passes through plan/ask for acp", () => {
  expect(resolveSessionModeForCore({ coreKind: "acp", sessionMode: "plan" })).toBe("plan");
  expect(resolveSessionModeForCore({ coreKind: "acp", sessionMode: "ask" })).toBe("ask");
  expect(resolveSessionModeForCore({ coreKind: "acp", sessionMode: "agent" })).toBe("agent");
});
