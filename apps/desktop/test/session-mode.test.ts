import { expect, test } from "bun:test";
import {
  isAskSessionMode,
  isPlanSessionMode,
  normalizeSessionMode,
  resolveSessionMode,
  togglePlusMenuSessionMode,
} from "../src/shared/session-mode";

test("resolveSessionMode prefers explicit sessionMode", () => {
  expect(resolveSessionMode({ sessionMode: "ask" })).toBe("ask");
  expect(resolveSessionMode({ sessionMode: "agent" })).toBe("agent");
  expect(resolveSessionMode({ sessionMode: "plan" })).toBe("plan");
});

test("resolveSessionMode defaults to agent", () => {
  expect(resolveSessionMode({})).toBe("agent");
  expect(resolveSessionMode(undefined)).toBe("agent");
});

test("normalizeSessionMode rejects invalid values", () => {
  expect(normalizeSessionMode("invalid")).toBe("agent");
  expect(normalizeSessionMode("plan")).toBe("plan");
});

test("session mode helpers", () => {
  expect(isAskSessionMode({ sessionMode: "ask" })).toBe(true);
  expect(isPlanSessionMode({ sessionMode: "plan" })).toBe(true);
  expect(isAskSessionMode({ sessionMode: "agent" })).toBe(false);
});

test("plus-menu Plan/Ask toggles off to agent when already selected", () => {
  expect(togglePlusMenuSessionMode("agent", "plan")).toBe("plan");
  expect(togglePlusMenuSessionMode("plan", "plan")).toBe("agent");
  expect(togglePlusMenuSessionMode("ask", "plan")).toBe("plan");
  expect(togglePlusMenuSessionMode("agent", "ask")).toBe("ask");
  expect(togglePlusMenuSessionMode("ask", "ask")).toBe("agent");
  expect(togglePlusMenuSessionMode("plan", "ask")).toBe("ask");
});
