import { expect, test } from "bun:test";
import {
  mermaidSourceToMarkdown,
  prepareMermaidSvgForCapture,
} from "../src/renderer/markdown-mermaid-clipboard";

test("mermaidSourceToMarkdown wraps a fenced mermaid block", () => {
  expect(mermaidSourceToMarkdown("flowchart TD\n  A-->B")).toBe(
    ["```mermaid", "flowchart TD", "  A-->B", "```"].join("\n"),
  );
});

test("mermaidSourceToMarkdown trims surrounding blank lines", () => {
  expect(mermaidSourceToMarkdown("\n\ngraph LR\n  A-->B\n\n")).toBe(
    ["```mermaid", "graph LR", "  A-->B", "```"].join("\n"),
  );
});

test("mermaidSourceToMarkdown returns empty for blank source", () => {
  expect(mermaidSourceToMarkdown("   \n  ")).toBe("");
});

test("prepareMermaidSvgForCapture adds xmlns, size, and background", () => {
  if (typeof document === "undefined") return;
  const prepared = prepareMermaidSvgForCapture(
    '<svg viewBox="0 0 120 80"><circle cx="60" cy="40" r="20" fill="#08f"/></svg>',
    "#ffffff",
  );
  expect(prepared).not.toBeNull();
  expect(prepared!.width).toBe(120);
  expect(prepared!.height).toBe(80);
  expect(prepared!.markup).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(prepared!.markup).toContain('width="120"');
  expect(prepared!.markup).toContain('height="80"');
  expect(prepared!.markup).toContain('fill="#ffffff"');
});

test("prepareMermaidSvgForCapture rejects empty or non-svg markup", () => {
  if (typeof document === "undefined") return;
  expect(prepareMermaidSvgForCapture("", "#fff")).toBeNull();
  expect(prepareMermaidSvgForCapture("<div>nope</div>", "#fff")).toBeNull();
});
