import { expect, test } from "bun:test";
import {
  buildEcoMermaidConfig,
  buildEcoMermaidThemeVariables,
  cleanupMermaidRenderArtifacts,
  computeMermaidFeedSize,
  isMermaidErrorSvg,
  isMermaidLang,
  MERMAID_FEED_HEIGHT_CACHE_LIMIT,
  MERMAID_FEED_MAX_HEIGHT_PX,
  mermaidPaintScaleFactor,
  readAppTheme,
  recallMermaidFeedHeight,
  rememberMermaidFeedHeight,
} from "../src/renderer/prosemirror/mermaid-block";

test("isMermaidLang first token only", () => {
  expect(isMermaidLang("mermaid")).toBe(true);
  expect(isMermaidLang("  MERMAID  ")).toBe(true);
  expect(isMermaidLang("mermaid dark")).toBe(true);
  expect(isMermaidLang("notmermaid")).toBe(false);
});

test("readAppTheme defaults without document theme", () => {
  expect(readAppTheme()).toBe("light");
});

test("isMermaidErrorSvg detects mermaid native error output", () => {
  expect(isMermaidErrorSvg('<svg><text class="error-text">Syntax error in text</text></svg>')).toBe(true);
  expect(isMermaidErrorSvg('<svg><circle r="4"/></svg>')).toBe(false);
});

test("mermaidPaintScaleFactor is at least 2x and follows DPR", () => {
  expect(mermaidPaintScaleFactor(1)).toBe(2);
  expect(mermaidPaintScaleFactor(1.25)).toBe(2);
  expect(mermaidPaintScaleFactor(2)).toBe(2);
  expect(mermaidPaintScaleFactor(2.5)).toBe(3);
  expect(mermaidPaintScaleFactor(0)).toBe(2);
});

test("computeMermaidFeedSize respects width and max height", () => {
  expect(MERMAID_FEED_MAX_HEIGHT_PX).toBe(420);
  // Tall diagram: height caps first
  expect(computeMermaidFeedSize({ width: 200, height: 800 }, 600, 420)).toEqual({
    width: 105,
    height: 420,
  });
  // Wide diagram: width caps first
  expect(computeMermaidFeedSize({ width: 800, height: 200 }, 400, 420)).toEqual({
    width: 400,
    height: 100,
  });
});

test("cleanupMermaidRenderArtifacts removes mermaid temp nodes", () => {
  if (typeof document === "undefined") return;
  const renderId = "eco-mermaid-test";
  for (const id of [renderId, `d${renderId}`, `i${renderId}`]) {
    const node = document.createElement("div");
    node.id = id;
    document.body.appendChild(node);
  }
  cleanupMermaidRenderArtifacts(renderId);
  expect(document.getElementById(renderId)).toBeNull();
  expect(document.getElementById(`d${renderId}`)).toBeNull();
  expect(document.getElementById(`i${renderId}`)).toBeNull();
});

test("buildEcoMermaidConfig uses Eco base theme", () => {
  const dark = buildEcoMermaidConfig("dark");
  const light = buildEcoMermaidConfig("light");
  expect(dark.theme).toBe("base");
  expect(light.theme).toBe("base");
  expect(dark.securityLevel).toBe("strict");
  expect((dark.flowchart as { curve: string }).curve).toBe("basis");
  expect(buildEcoMermaidThemeVariables("dark").darkMode).toBe(true);
  expect(buildEcoMermaidThemeVariables("light").darkMode).toBe(false);
  expect(buildEcoMermaidThemeVariables("dark").primaryColor).toBeTruthy();
});

test("feed diagram height survives release and re-mount", () => {
  // The placeholder that stands in for a released diagram is sized from this,
  // so a diagram keeps the box the virtualizer already measured for it.
  const source = "graph TD;  A-->B;";
  rememberMermaidFeedHeight(source, 240.6);
  expect(recallMermaidFeedHeight("graph TD; A-->B;")).toBe(241);
  // A re-render (theme switch, resize) refreshes the remembered box.
  rememberMermaidFeedHeight("graph TD; A-->B;", 180);
  expect(recallMermaidFeedHeight(source)).toBe(180);
});

test("feed diagram height cache ignores unusable measurements", () => {
  // A hidden host reports 0; storing it would collapse the placeholder.
  const source = "graph TD; hidden-->gone;";
  for (const height of [0, -12, Number.NaN]) {
    rememberMermaidFeedHeight(source, height);
  }
  expect(recallMermaidFeedHeight(source)).toBe(0);
  rememberMermaidFeedHeight("   ", 240);
  expect(recallMermaidFeedHeight("")).toBe(0);
});

test("feed diagram height cache stays a bounded LRU window", () => {
  const sources = Array.from(
    { length: MERMAID_FEED_HEIGHT_CACHE_LIMIT + 8 },
    (_, index) => `graph TD; n${index}-->x;`,
  );
  for (const source of sources) {
    rememberMermaidFeedHeight(source, 120);
  }
  expect(recallMermaidFeedHeight(sources[0]!)).toBe(0);
  expect(recallMermaidFeedHeight(sources[sources.length - 1]!)).toBe(120);

  // Reading a diagram keeps it alive while newer ones are remembered.
  const kept = "graph TD; kept-->x;";
  rememberMermaidFeedHeight(kept, 96);
  for (let index = 0; index < MERMAID_FEED_HEIGHT_CACHE_LIMIT - 2; index += 1) {
    rememberMermaidFeedHeight(`graph TD; churn${index}-->x;`, 60);
    recallMermaidFeedHeight(kept);
  }
  expect(recallMermaidFeedHeight(kept)).toBe(96);
});
