import { expect, test } from "bun:test";
import {
  clearRequestStartedPersisted,
  markRequestStartedPersisted,
  requestTerminalLiveType,
  requestTerminalMessage,
} from "../src/main/thread-request-lifecycle";

test("markRequestStartedPersisted dedupes request ids per thread", () => {
  expect(markRequestStartedPersisted("thr_1", "req_a")).toBe(true);
  expect(markRequestStartedPersisted("thr_1", "req_a")).toBe(false);
  expect(markRequestStartedPersisted("thr_1", "req_b")).toBe(true);
  expect(markRequestStartedPersisted("thr_2", "req_a")).toBe(true);
});

test("clearRequestStartedPersisted clears one id or the whole thread", () => {
  markRequestStartedPersisted("thr_1", "req_a");
  markRequestStartedPersisted("thr_1", "req_b");
  clearRequestStartedPersisted("thr_1", "req_a");
  expect(markRequestStartedPersisted("thr_1", "req_a")).toBe(true);
  expect(markRequestStartedPersisted("thr_1", "req_b")).toBe(false);
  clearRequestStartedPersisted("thr_1");
  expect(markRequestStartedPersisted("thr_1", "req_b")).toBe(true);
});

test("requestTerminalLiveType and requestTerminalMessage map stages", () => {
  expect(requestTerminalLiveType("completed")).toBe("request.completed");
  expect(requestTerminalLiveType("failed")).toBe("request.failed");
  expect(requestTerminalLiveType("cancelled")).toBe("request.cancelled");
  expect(requestTerminalMessage("completed")).toBe("模型请求完成");
  expect(requestTerminalMessage("failed", "HTTP 502")).toBe("HTTP 502");
});
