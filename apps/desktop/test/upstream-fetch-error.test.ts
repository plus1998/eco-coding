import { expect, test } from "bun:test";
import { formatUpstreamFetchError } from "../src/main/upstream-log";

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
