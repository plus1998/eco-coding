import { expect, test } from "bun:test";
import {
  createFeedMarkdownDoc,
  isMermaidLang,
  markdownTableHeaderMinWidthCh,
  renderFeedMarkdownHtml,
} from "../src/renderer/prosemirror/feed-markdown";

test("createFeedMarkdownDoc models paragraphs, code fences, and file refs", () => {
  const doc = createFeedMarkdownDoc(
    ["hello", "", "```ts", "const x = 1", "```", "", "See /tmp/a.ts:2"].join("\n"),
  );
  const types: string[] = [];
  doc.descendants((node) => {
    types.push(node.type.name);
  });
  expect(types).toContain("paragraph");
  expect(types).toContain("code_block");
  expect(types).toContain("file_ref");
});

test("createFeedMarkdownDoc models GFM tables and blockquotes", () => {
  const doc = createFeedMarkdownDoc(
    ["> quoted", "", "| a | b |", "| --- | --- |", "| 1 | 2 |", "", "~~old~~"].join("\n"),
  );
  const types: string[] = [];
  const marks: string[] = [];
  doc.descendants((node) => {
    types.push(node.type.name);
    for (const mark of node.marks) marks.push(mark.type.name);
  });
  expect(types).toContain("blockquote");
  expect(types).toContain("table");
  expect(types).toContain("table_header");
  expect(types).toContain("table_cell");
  expect(marks).toContain("strikethrough");
});

test("renderFeedMarkdownHtml keeps external links and fenced language labels", () => {
  const html = renderFeedMarkdownHtml("[Docs](https://example.com)\n\n```json\n{}\n```");
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain('target="_blank"');
  expect(html).toContain("markdown-code-block__language");
  expect(html).toContain(">json<");
});

test("inline code mark uses markdown-inline-code class in the document model", () => {
  const doc = createFeedMarkdownDoc("use `foo` here");
  let saw = false;
  doc.descendants((node) => {
    if (!node.isText) return;
    if (node.marks.some((m) => m.type.name === "code")) {
      saw = true;
      expect(node.text).toBe("foo");
    }
  });
  expect(saw).toBe(true);
  const html = renderFeedMarkdownHtml("use `foo` here");
  expect(html).toContain('class="markdown-inline-code"');
  expect(html).toContain(">foo<");
});

test("renderFeedMarkdownHtml serializes tables blockquotes and file refs", () => {
  const html = renderFeedMarkdownHtml(
    ["> note", "", "| h |", "| --- |", "| c |", "", "See /tmp/x.ts"].join("\n"),
  );
  expect(html).toContain("<blockquote>");
  expect(html).toContain('<table class="markdown-table">');
  expect(html).toContain("<th");
  expect(html).toContain('class="markdown-table-th"');
  expect(html).toContain("min-width:");
  expect(html).toContain("<td>");
  expect(html).toContain("markdown-file-ref");
  expect(html).not.toMatch(/class="markdown-file-ref"[^>]*target="_blank"/);
});

test("markdownTableHeaderMinWidthCh prefers about half the unwrapped measure", () => {
  expect(markdownTableHeaderMinWidthCh("abcd")).toBe(4); // floor
  expect(markdownTableHeaderMinWidthCh("abcdefgh")).toBe(4);
  expect(markdownTableHeaderMinWidthCh("abcdefghij")).toBe(5);
  // CJK counts double → "路由示例" (4 chars → 8 units) → min 4ch
  expect(markdownTableHeaderMinWidthCh("路由示例")).toBe(4);
  expect(markdownTableHeaderMinWidthCh("输入单价与价差说明文字")).toBe(11);
  expect(markdownTableHeaderMinWidthCh("x".repeat(80))).toBe(28); // cap
});

test("isMermaidLang matches mermaid fence params", () => {
  expect(isMermaidLang("mermaid")).toBe(true);
  expect(isMermaidLang("Mermaid")).toBe(true);
  expect(isMermaidLang("mermaid theme")).toBe(true);
  expect(isMermaidLang("ts")).toBe(false);
  expect(isMermaidLang("")).toBe(false);
});

test("renderFeedMarkdownHtml marks mermaid fences without rendering SVG", () => {
  const html = renderFeedMarkdownHtml(
    ["```mermaid", "graph TD", "  A-->B", "```"].join("\n"),
  );
  expect(html).toContain("markdown-code-block--mermaid");
  expect(html).toContain("language-mermaid");
  expect(html).toContain("A--&gt;B");
  expect(html).not.toContain("<svg");
});

test("renderFeedMarkdownHtml renders html fences as preview cards", () => {
  const html = renderFeedMarkdownHtml(
    ["```html", "<html><title>Demo</title><body>Hi</body></html>", "```"].join("\n"),
  );
  expect(html).toContain("markdown-code-block--html");
  expect(html).toContain("markdown-html-card");
  expect(html).toContain("Demo");
  expect(html).not.toContain("<body>Hi</body>");
});
