import { expect, test } from "bun:test";
import { parseThreadRunProjectionGetRequest } from "../src/main/thread-run-projection-request";

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

test("parseThreadRunProjectionGetRequest accepts feed mode object", () => {
  expect(
    parseThreadRunProjectionGetRequest({
      threadId: "thr_1",
      mode: "feed",
    }),
  ).toEqual({
    threadId: "thr_1",
    mode: "feed",
  });
});
