import { expect, test } from "bun:test";
import {
  createAutoCloseState,
  listExpiredAutoCloseTabIds,
  pruneStaleAutoCloseEntries,
  tickAutoCloseRemainingSeconds,
} from "../src/renderer/terminal-auto-close";

test("pruneStaleAutoCloseEntries drops countdown when tab session changed", () => {
  const autoClose = {
    tab_a: createAutoCloseState("session_old", 1_000, 5_000),
    tab_b: createAutoCloseState("session_keep", 1_000, 5_000),
  };
  const next = pruneStaleAutoCloseEntries(autoClose, {
    tab_a: "session_new",
    tab_b: "session_keep",
  });
  expect(Object.keys(next)).toEqual(["tab_b"]);
  expect(next.tab_b?.sessionId).toBe("session_keep");
});

test("pruneStaleAutoCloseEntries keeps object identity when unchanged", () => {
  const autoClose = {
    tab_a: createAutoCloseState("session_a", 1_000, 5_000),
  };
  const next = pruneStaleAutoCloseEntries(autoClose, { tab_a: "session_a" });
  expect(next).toBe(autoClose);
});

test("listExpiredAutoCloseTabIds ignores deadline when session was replaced", () => {
  const now = 10_000;
  const autoClose = {
    tab_a: createAutoCloseState("session_old", 0, 5_000),
    tab_b: createAutoCloseState("session_b", 0, 5_000),
  };
  const expired = listExpiredAutoCloseTabIds(
    autoClose,
    {
      tab_a: "session_new",
      tab_b: "session_b",
    },
    now,
  );
  expect(expired).toEqual(["tab_b"]);
});

test("listExpiredAutoCloseTabIds waits until deadline", () => {
  const autoClose = {
    tab_a: createAutoCloseState("session_a", 1_000, 5_000),
  };
  expect(listExpiredAutoCloseTabIds(autoClose, { tab_a: "session_a" }, 5_999)).toEqual([]);
  expect(listExpiredAutoCloseTabIds(autoClose, { tab_a: "session_a" }, 6_000)).toEqual(["tab_a"]);
});

test("tickAutoCloseRemainingSeconds floors display seconds", () => {
  const countdown = createAutoCloseState("session_a", 0, 5_000);
  const updated = tickAutoCloseRemainingSeconds(countdown, 2_400);
  expect(updated.remainingSeconds).toBe(3);
  expect(updated).not.toBe(countdown);
  expect(tickAutoCloseRemainingSeconds(updated, 2_400)).toBe(updated);
});
