import { describe, expect, it } from "bun:test";
import {
  collectProtectedProjectionThreadIds,
  listEvictableProjectionThreadIds,
  rememberRecentlyViewedThread,
  removeRecordKeys,
} from "../src/renderer/thread-projection-cache-policy";

describe("thread-projection-cache-policy", () => {
  it("tracks recent views with current first and capped length", () => {
    expect(rememberRecentlyViewedThread([], "a", 3)).toEqual(["a"]);
    expect(rememberRecentlyViewedThread(["a"], "b", 3)).toEqual(["b", "a"]);
    expect(rememberRecentlyViewedThread(["b", "a"], "c", 3)).toEqual(["c", "b", "a"]);
    expect(rememberRecentlyViewedThread(["c", "b", "a"], "d", 3)).toEqual(["d", "c", "b"]);
    expect(rememberRecentlyViewedThread(["d", "c", "b"], "c", 3)).toEqual(["c", "d", "b"]);
  });

  it("protects selected, feed, hot, and LRU peers", () => {
    const protectedIds = collectProtectedProjectionThreadIds({
      selectedThreadId: "current",
      feedThreadId: "feed",
      recentlyViewedThreadIds: ["current", "peer-1", "peer-2", "peer-3"],
      hotThreadIds: ["live-run"],
      lruSize: 2,
    });
    expect([...protectedIds].sort()).toEqual(
      ["current", "feed", "live-run", "peer-1", "peer-2"].sort(),
    );
  });

  it("does not let hot threads consume LRU slots", () => {
    const protectedIds = collectProtectedProjectionThreadIds({
      selectedThreadId: "current",
      recentlyViewedThreadIds: ["current", "hot-bg", "idle-a", "idle-b"],
      hotThreadIds: ["hot-bg"],
      lruSize: 2,
    });
    expect(protectedIds.has("idle-a")).toBe(true);
    expect(protectedIds.has("idle-b")).toBe(true);
    expect(protectedIds.has("hot-bg")).toBe(true);
  });

  it("lists only unprotected cached ids", () => {
    const protectedIds = new Set(["keep-a", "keep-b"]);
    expect(
      listEvictableProjectionThreadIds(["keep-a", "drop-1", "keep-b", "drop-2", "drop-1"], protectedIds),
    ).toEqual(["drop-1", "drop-2"]);
  });

  it("removeRecordKeys drops matching keys without cloning when unchanged", () => {
    const record = { a: 1, b: 2 };
    expect(removeRecordKeys(record, [])).toBe(record);
    expect(removeRecordKeys(record, ["missing"])).toBe(record);
    expect(removeRecordKeys(record, ["a"])).toEqual({ b: 2 });
  });

  it("A→B→C→D leave only current + LRU(2) protected among idle caches", () => {
    let recent: string[] = [];
    const cached = ["A", "B", "C", "D"];
    for (const id of cached) {
      recent = rememberRecentlyViewedThread(recent, id);
    }
    expect(recent).toEqual(["D", "C", "B"]);

    const protectedIds = collectProtectedProjectionThreadIds({
      selectedThreadId: "D",
      feedThreadId: "D",
      recentlyViewedThreadIds: recent,
      hotThreadIds: [],
      lruSize: 2,
    });
    expect([...protectedIds].sort()).toEqual(["B", "C", "D"].sort());
    expect(listEvictableProjectionThreadIds(cached, protectedIds)).toEqual(["A"]);
  });

  it("keeps a background running thread even when outside LRU", () => {
    let recent: string[] = [];
    for (const id of ["A", "B", "C", "D"]) {
      recent = rememberRecentlyViewedThread(recent, id);
    }
    const protectedIds = collectProtectedProjectionThreadIds({
      selectedThreadId: "D",
      feedThreadId: "D",
      recentlyViewedThreadIds: recent,
      hotThreadIds: ["A"],
      lruSize: 2,
    });
    expect(protectedIds.has("A")).toBe(true);
    expect(listEvictableProjectionThreadIds(["A", "B", "C", "D"], protectedIds)).toEqual([]);
  });
});
