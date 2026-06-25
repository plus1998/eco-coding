import { expect, test } from "bun:test";
import {
  isAskSessionMode,
  isPlanSessionMode,
  resolveSessionMode,
  syncSessionModeFields,
} from "../src/shared/session-mode";

test("resolveSessionMode prefers explicit sessionMode", () => {
  expect(resolveSessionMode({ sessionMode: "ask", planModeEnabled: true })).toBe("ask");
  expect(resolveSessionMode({ sessionMode: "agent", planModeEnabled: true })).toBe("agent");
});

test("resolveSessionMode migrates legacy planModeEnabled", () => {
  expect(resolveSessionMode({ planModeEnabled: true })).toBe("plan");
  expect(resolveSessionMode({ planModeEnabled: false })).toBe("agent");
});

test("syncSessionModeFields keeps plan flag aligned", () => {
  expect(syncSessionModeFields({ sessionMode: "ask" })).toEqual({
    sessionMode: "ask",
    planModeEnabled: false,
  });
  expect(syncSessionModeFields({ sessionMode: "plan" })).toEqual({
    sessionMode: "plan",
    planModeEnabled: true,
  });
});

test("session mode helpers", () => {
  expect(isAskSessionMode({ sessionMode: "ask" })).toBe(true);
  expect(isPlanSessionMode({ sessionMode: "plan" })).toBe(true);
  expect(isAskSessionMode({ planModeEnabled: false })).toBe(false);
});
