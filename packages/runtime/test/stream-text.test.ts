import { expect, test } from "bun:test";
import { mergeStreamText } from "../src/stream-text";

test("appends stream deltas within a word", () => {
  expect(mergeStreamText("hel", "lo")).toBe("hello");
});

test("accepts cumulative snapshots", () => {
  expect(mergeStreamText("No", "No markdown")).toBe("No markdown");
});

test("inserts word boundary space when chunks omit it", () => {
  expect(mergeStreamText("Let me also", "check")).toBe("Let me also check");
  expect(mergeStreamText("No", "markdown")).toBe("No markdown");
  expect(mergeStreamText("in", "the")).toBe("in the");
  expect(mergeStreamText("to", "understand")).toBe("to understand");
});

test("preserves explicit spaces in deltas", () => {
  expect(mergeStreamText("No", " markdown")).toBe("No markdown");
});

test("does not add space before punctuation", () => {
  expect(mergeStreamText("setup", ".")).toBe("setup.");
});
