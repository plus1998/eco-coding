import { expect, test } from "bun:test";
import {
  encodeThreadRunProjectionGetArg,
  parseThreadRunProjectionGetRequest,
} from "../src/main/thread-run-projection-request";

test("parseThreadRunProjectionGetRequest accepts legacy string thread id", () => {
  expect(parseThreadRunProjectionGetRequest(" thr_1 ")).toEqual({
    threadId: "thr_1",
    mode: "full",
  });
});

test("parseThreadRunProjectionGetRequest accepts feed mode as second string arg", () => {
  expect(parseThreadRunProjectionGetRequest("thr_1", "feed")).toEqual({
    threadId: "thr_1",
    mode: "feed",
  });
});

test("parseThreadRunProjectionGetRequest accepts feed mode encoded in single string arg", () => {
  expect(parseThreadRunProjectionGetRequest("feed:thr_1")).toEqual({
    threadId: "thr_1",
    mode: "feed",
  });
});

test("parseThreadRunProjectionGetRequest accepts feed mode afterSequence encoding", () => {
  const arg = encodeThreadRunProjectionGetArg("thr:1", "feed", {
    afterSequence: 42,
    historyRevision: 3,
  });

  expect(arg).toBe("feed:thr%3A1?afterSequence=42&historyRevision=3");
  expect(parseThreadRunProjectionGetRequest(arg)).toEqual({
    threadId: "thr:1",
    mode: "feed",
    afterSequence: 42,
    historyRevision: 3,
  });
});

test("parseThreadRunProjectionGetRequest accepts feed mode object", () => {
  expect(
    parseThreadRunProjectionGetRequest({
      threadId: "thr_1",
      mode: "feed",
      afterSequence: 7,
      historyRevision: 2,
    }),
  ).toEqual({
    threadId: "thr_1",
    mode: "feed",
    afterSequence: 7,
    historyRevision: 2,
  });
});
