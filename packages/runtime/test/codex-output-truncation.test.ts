import { expect, test } from "bun:test";
import {
  approxTokenCount,
  DEFAULT_TOOL_OUTPUT_TOKEN_LIMIT,
  formattedTruncateText,
  toolOutputHistoryPolicy,
  truncateMiddleWithTokenBudget,
  truncateText,
  truncateToolOutputForHistory,
} from "../src/codex-output-truncation";

test("approxTokenCount is bytes/4 ceiling", () => {
  expect(approxTokenCount("")).toBe(0);
  expect(approxTokenCount("abcd")).toBe(1);
  expect(approxTokenCount("abcde")).toBe(2);
});

test("DEFAULT_TOOL_OUTPUT_TOKEN_LIMIT and serialization budget match Codex", () => {
  expect(DEFAULT_TOOL_OUTPUT_TOKEN_LIMIT).toBe(10_000);
  const policy = toolOutputHistoryPolicy();
  expect(policy).toEqual({ mode: "tokens", limit: 12_000 });
});

test("truncateMiddleWithTokenBudget returns original under limit", () => {
  const s = "short output";
  const result = truncateMiddleWithTokenBudget(s, 100);
  expect(result.truncated).toBe(false);
  expect(result.text).toBe(s);
});

test("truncateMiddleWithTokenBudget middle-truncates with token marker", () => {
  const s = "this is an example of a long output that should be truncated";
  const result = truncateMiddleWithTokenBudget(s, 5);
  expect(result.truncated).toBe(true);
  expect(result.text).toContain("tokens truncated");
  expect(result.text.startsWith("this")).toBe(true);
  expect(result.text.endsWith("truncated")).toBe(true);
  expect(result.originalTokenCount).toBe(approxTokenCount(s));
});

test("truncateMiddleWithTokenBudget zero budget yields marker only", () => {
  const s = "ab";
  const result = truncateMiddleWithTokenBudget(s, 0);
  expect(result.truncated).toBe(true);
  expect(result.text).toMatch(/tokens truncated/);
});

test("formattedTruncateText under limit is identity", () => {
  expect(formattedTruncateText("hello", { mode: "tokens", limit: 100 })).toBe("hello");
});

test("formattedTruncateText adds Warning header when truncated", () => {
  const content = "this is an example of a long output that should be truncated";
  const out = formattedTruncateText(content, { mode: "tokens", limit: 5 });
  expect(out).toContain("Warning: truncated output (original token count:");
  expect(out).toContain("Total output lines: 1");
  expect(out).toContain("tokens truncated");
});

test("formattedTruncateText reports multi-line count", () => {
  const content =
    "this is an example of a long output that should be truncated\nalso some other line";
  const out = formattedTruncateText(content, { mode: "bytes", limit: 30 });
  expect(out).toContain("Total output lines: 2");
  expect(out).toContain("chars truncated");
});

test("truncateText tokens path uses middle truncate", () => {
  const content = "this is an example of a long output that should be truncated";
  const out = truncateText(content, { mode: "tokens", limit: 5 });
  expect(out).toContain("tokens truncated");
});

test("truncateToolOutputForHistory leaves short strings unchanged", () => {
  const result = truncateToolOutputForHistory("ok");
  expect(result.truncated).toBe(false);
  expect(result.value).toBe("ok");
  expect(result.text).toBe("ok");
});

test("truncateToolOutputForHistory stringifies objects then truncates", () => {
  const huge = { data: "x".repeat(80_000) };
  const result = truncateToolOutputForHistory(huge, { mode: "tokens", limit: 20 });
  expect(result.truncated).toBe(true);
  expect(typeof result.value).toBe("string");
  expect(String(result.value)).toContain("Warning: truncated output");
});
