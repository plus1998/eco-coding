import { afterEach, expect, test } from "bun:test";
import {
  attachThreadCancelling,
  attachThreadListCancelling,
  clearThreadCancelling,
  isThreadCancelling,
  markThreadCancelling,
  shouldKeepThreadCancelling,
} from "../src/main/thread-cancelling-state";

afterEach(() => {
  clearThreadCancelling("thr_a");
  clearThreadCancelling("thr_b");
});

test("markThreadCancelling is live-only overlay until cleared", () => {
  expect(isThreadCancelling("thr_a")).toBe(false);
  expect(markThreadCancelling("thr_a")).toBe(true);
  expect(markThreadCancelling("thr_a")).toBe(false);
  expect(isThreadCancelling("thr_a")).toBe(true);
  expect(clearThreadCancelling("thr_a")).toBe(true);
  expect(isThreadCancelling("thr_a")).toBe(false);
});

test("attachThreadCancelling stamps cancelling without mutating unmarked threads", () => {
  markThreadCancelling("thr_a");
  expect(attachThreadCancelling({ id: "thr_a", status: "running" })).toEqual({
    id: "thr_a",
    status: "running",
    cancelling: true,
  });
  expect(attachThreadCancelling({ id: "thr_b", status: "running" })).toEqual({
    id: "thr_b",
    status: "running",
  });
});

test("attachThreadListCancelling only flags marked threads", () => {
  markThreadCancelling("thr_b");
  expect(
    attachThreadListCancelling([
      { id: "thr_a", title: "A" },
      { id: "thr_b", title: "B" },
    ]),
  ).toEqual([
    { id: "thr_a", title: "A" },
    { id: "thr_b", title: "B", cancelling: true },
  ]);
});

test("shouldKeepThreadCancelling only while the run is still live", () => {
  expect(shouldKeepThreadCancelling("running")).toBe(true);
  expect(shouldKeepThreadCancelling("queued")).toBe(true);
  expect(shouldKeepThreadCancelling("idle")).toBe(false);
  expect(shouldKeepThreadCancelling("awaiting_plan")).toBe(false);
});
