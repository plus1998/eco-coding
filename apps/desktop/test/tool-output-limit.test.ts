import { expect, test } from "bun:test";
import {
  appendToolOutputPreviewCapture,
  createToolOutputPreview,
  materializeToolOutputPreviewCapture,
  MAX_BASH_OUTPUT_PREVIEW_CHARS,
  type ToolOutputPreviewCapture,
} from "@eco/runtime";

test("createToolOutputPreview keeps short output unchanged", () => {
  const result = createToolOutputPreview("hello");
  expect(result.truncated).toBe(false);
  expect(result.text).toBe("hello");
});

test("createToolOutputPreview keeps bounded head and tail", () => {
  const huge = `${"a".repeat(MAX_BASH_OUTPUT_PREVIEW_CHARS)}TAIL`;
  const result = createToolOutputPreview(huge);
  expect(result.truncated).toBe(true);
  expect(result.text).toStartWith("aaaa");
  expect(result.text).toEndWith("TAIL");
  expect(result.text.length).toBeLessThanOrEqual(MAX_BASH_OUTPUT_PREVIEW_CHARS);
});

test("stream capture never retains unbounded command output", () => {
  let capture: ToolOutputPreviewCapture | undefined;
  capture = appendToolOutputPreviewCapture(capture, "head\n");
  capture = appendToolOutputPreviewCapture(capture, "x".repeat(50_000));
  capture = appendToolOutputPreviewCapture(capture, "\ntail");
  const preview = materializeToolOutputPreviewCapture(capture);
  expect(preview?.truncated).toBe(true);
  expect(preview?.text).toStartWith("head\n");
  expect(preview?.text).toEndWith("\ntail");
  expect(preview?.text.length).toBeLessThanOrEqual(MAX_BASH_OUTPUT_PREVIEW_CHARS);
});
