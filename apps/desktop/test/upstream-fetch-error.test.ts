import path from "node:path";
import { expect, test } from "bun:test";
import {
  formatUpstreamFetchError,
  formatUpstreamLogDateKey,
  getUpstreamLogFilePath,
} from "../src/main/upstream-log";

test("getUpstreamLogFilePath writes to a local-date log file", () => {
  const previous = process.env.ECO_UPSTREAM_LOG_DIR;
  process.env.ECO_UPSTREAM_LOG_DIR = "/tmp/eco-upstream-test";

  try {
    const july9 = new Date(2026, 6, 9, 23, 59);
    const july10 = new Date(2026, 6, 10, 0, 0);

    expect(formatUpstreamLogDateKey(july9)).toBe("2026-07-09");
    expect(getUpstreamLogFilePath(july9)).toBe(
      path.join("/tmp/eco-upstream-test", "upstream-2026-07-09.log"),
    );
    expect(getUpstreamLogFilePath(july10)).toBe(
      path.join("/tmp/eco-upstream-test", "upstream-2026-07-10.log"),
    );
  } finally {
    if (previous === undefined) {
      delete process.env.ECO_UPSTREAM_LOG_DIR;
    } else {
      process.env.ECO_UPSTREAM_LOG_DIR = previous;
    }
  }
});

test("formatUpstreamFetchError unwraps cause chain", () => {
  const root = new TypeError("fetch failed", {
    cause: new Error("connect ECONNREFUSED 127.0.0.1:443", { cause: { code: "ECONNREFUSED" } }),
  });
  const formatted = formatUpstreamFetchError(root);
  expect(formatted).toContain("fetch failed");
  expect(formatted).toContain("ECONNREFUSED");
});

test("formatUpstreamFetchError handles non-error values", () => {
  expect(formatUpstreamFetchError("boom")).toBe("boom");
});
