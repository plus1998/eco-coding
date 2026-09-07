import { describe, expect, it } from "bun:test";
import {
  ThreadProjectionMemoryCoordinator,
} from "../src/main/thread-projection-memory";

describe("ThreadProjectionMemoryCoordinator", () => {
  it("releases unprotected idle threads after delay and keeps hot + LRU", () => {
    const released: string[] = [];
    const timers = new Map<string, () => void>();
    let hot = new Set<string>(["live"]);
    const retained = new Set(["A", "B", "C", "D", "live"]);

    const coordinator = new ThreadProjectionMemoryCoordinator({
      getHotThreadIds: () => [...hot],
      listRetainedThreadIds: () => [...retained],
      releaseThread: (threadId) => {
        released.push(threadId);
        retained.delete(threadId);
      },
      evictDelayMs: 1_000,
      setTimer: (callback) => {
        const id = `t${timers.size}`;
        timers.set(id, callback);
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (timer) => {
        timers.delete(String(timer));
      },
    });

    coordinator.reportFocus({
      selectedThreadId: "D",
      feedThreadId: "D",
      recentlyViewedThreadIds: ["D", "C", "B", "A"],
    });

    expect(coordinator.getDebugState().pendingEvictions.sort()).toEqual(["A"].sort());

    for (const callback of [...timers.values()]) {
      callback();
    }
    expect(released).toEqual(["A"]);
    expect(retained.has("A")).toBe(false);
    expect(retained.has("live")).toBe(true);
    expect(retained.has("B")).toBe(true);

    hot = new Set();
    retained.add("A");
    coordinator.noteThreadTouched("A");
    coordinator.reportFocus({
      selectedThreadId: "D",
      feedThreadId: "D",
      recentlyViewedThreadIds: ["D", "C", "B"],
    });
    expect(coordinator.getDebugState().pendingEvictions.includes("A")).toBe(true);
  });

  it("cancels pending eviction when thread becomes selected", () => {
    const released: string[] = [];
    const timers = new Map<string, () => void>();
    const retained = new Set(["A", "B"]);

    const coordinator = new ThreadProjectionMemoryCoordinator({
      getHotThreadIds: () => [],
      listRetainedThreadIds: () => [...retained],
      releaseThread: (threadId) => {
        released.push(threadId);
        retained.delete(threadId);
      },
      evictDelayMs: 1_000,
      setTimer: (callback) => {
        const id = `t${timers.size}`;
        timers.set(id, callback);
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (timer) => {
        timers.delete(String(timer));
      },
    });

    coordinator.reportFocus({
      selectedThreadId: "B",
      recentlyViewedThreadIds: ["B"],
    });
    expect(coordinator.getDebugState().pendingEvictions).toEqual(["A"]);

    coordinator.reportFocus({
      selectedThreadId: "A",
      recentlyViewedThreadIds: ["A", "B"],
    });
    expect(coordinator.getDebugState().pendingEvictions).toEqual([]);

    for (const callback of [...timers.values()]) {
      callback();
    }
    expect(released).toEqual([]);
  });
});
