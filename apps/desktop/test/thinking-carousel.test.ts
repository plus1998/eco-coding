import { expect, test } from "bun:test";
import { resolveThinkingCarouselIndex } from "../src/renderer/thinking-carousel";

test("thinking carousel keeps its stage when the tip only grew", () => {
  expect(resolveThinkingCarouselIndex(["第一句"], ["第一句", "第二句"], 0)).toBe(0);
  expect(resolveThinkingCarouselIndex(["第一句"], [], 0)).toBe(0);
  expect(resolveThinkingCarouselIndex(["第一句", "第二句"], ["第一句", "第二句", "第三句"], 1)).toBe(1);
});

test("thinking carousel follows stages trimmed off the front of the label", () => {
  // reasoningSummaryLabel keeps the newest stages, so older ones slide out from the front
  // while playback may still be sitting on one of them.
  expect(resolveThinkingCarouselIndex(["a", "b", "c"], ["b", "c", "d"], 2)).toBe(1);
  expect(resolveThinkingCarouselIndex(["a", "b", "c"], ["b", "c", "d"], 1)).toBe(0);
});

test("thinking carousel starts over for a different tip", () => {
  expect(resolveThinkingCarouselIndex(["a", "b"], ["完全不同的阶段"], 1)).toBe(0);
  expect(resolveThinkingCarouselIndex(null, ["a", "b"], 1)).toBe(0);
});

test("thinking carousel never lands past the stages that remain", () => {
  const previousLines = ["a", "b", "c", "d", "e"];
  const stageLists = [["a"], ["a", "b"], ["b", "c", "d"], ["c", "d", "e", "f"], ["x"]];
  for (const index of previousLines.keys()) {
    for (const lines of stageLists) {
      const resolved = resolveThinkingCarouselIndex(previousLines, lines, index);
      expect(resolved).toBeGreaterThanOrEqual(0);
      expect(resolved).toBeLessThanOrEqual(lines.length - 1);
    }
  }
});
