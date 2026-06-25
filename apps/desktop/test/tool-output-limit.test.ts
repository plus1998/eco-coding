import { expect, test } from "bun:test";
import {
  DEFAULT_MAX_TOOL_OUTPUT_CHARS,
  formatToolOutputTruncationMessage,
  limitToolOutputForContext,
} from "../src/shared/tool-output-limit";

test("limitToolOutputForContext keeps short output unchanged", () => {
  const result = limitToolOutputForContext("hello");
  expect(result.truncated).toBe(false);
  expect(result.text).toBe("hello");
});

test("limitToolOutputForContext truncates oversized output", () => {
  const huge = "x".repeat(DEFAULT_MAX_TOOL_OUTPUT_CHARS + 500);
  const result = limitToolOutputForContext(huge, 200);
  expect(result.truncated).toBe(true);
  expect(result.originalChars).toBe(huge.length);
  expect(result.text).toContain("输出已截断");
  expect(result.text.length).toBeLessThanOrEqual(200);
});

test("formatToolOutputTruncationMessage includes char counts", () => {
  const message = formatToolOutputTruncationMessage({
    toolName: "Bash",
    originalChars: 48_000,
    keptChars: 8_000,
  });
  expect(message).toContain("Bash");
  expect(message).toContain("48,000");
  expect(message).toContain("8,000");
});
