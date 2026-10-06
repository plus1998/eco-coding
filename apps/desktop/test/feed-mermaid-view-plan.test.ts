import { expect, test } from "bun:test";
import {
  MERMAID_FEED_RELEASE_BEYOND_PX,
  MERMAID_FEED_RENDER_AHEAD_PX,
  planMermaidFeedView,
} from "../src/renderer/prosemirror/feed-markdown";

const base = {
  hasSource: true,
  previewOpen: true,
  visible: true,
  hasCachedSvg: false,
} as const;

test("visible diagram without cache renders Mermaid", () => {
  expect(planMermaidFeedView(base)).toBe("render");
});

test("offscreen diagram shows the placeholder", () => {
  expect(planMermaidFeedView({ ...base, visible: false })).toBe("deferred");
});

test("released diagram re-mounts its cached SVG instead of staying deferred", () => {
  // The released state keeps the cached markup for expand/copy, so scrolling
  // back in must re-mount it. Returning the placeholder here (or re-running
  // Mermaid) is the regression that left every released diagram stuck.
  expect(planMermaidFeedView({ ...base, hasCachedSvg: true })).toBe("cached-svg");
  expect(planMermaidFeedView({ ...base, visible: false, hasCachedSvg: true })).toBe("deferred");
});

test("closed preview and empty source fall back to the source view", () => {
  expect(planMermaidFeedView({ ...base, previewOpen: false })).toBe("source");
  expect(planMermaidFeedView({ ...base, previewOpen: false, hasCachedSvg: true })).toBe("source");
  expect(planMermaidFeedView({ ...base, hasSource: false, hasCachedSvg: true })).toBe("source");
});

test("rendering and releasing use separate margins with a wide safety band", () => {
  // A single boundary makes a diagram mount and release again on every wobble
  // around it, so releasing must stay well past the point where we render.
  expect(MERMAID_FEED_RELEASE_BEYOND_PX).toBeGreaterThanOrEqual(MERMAID_FEED_RENDER_AHEAD_PX * 2);
  // Roughly two feed screens of dead zone where the mounted state never flips.
  expect(MERMAID_FEED_RELEASE_BEYOND_PX - MERMAID_FEED_RENDER_AHEAD_PX).toBeGreaterThanOrEqual(1_500);
});
