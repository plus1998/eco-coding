import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownContent } from "../src/renderer/MarkdownContent";

test("renders absolute markdown file links with material icon and line label", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      text: "[App.tsx](/repo/src/App.tsx:12:3)",
    }),
  );

  expect(html).toContain('href="/repo/src/App.tsx:12:3"');
  expect(html).toContain("markdown-file-ref");
  expect(html).toContain('class="markdown-file-ref__icon"');
  expect(html).toContain("react_ts");
  expect(html).toContain("App.tsx (line 12)");
  expect(html).not.toContain('target="_blank"');
});

test("linkifies bare absolute paths with material icon and line label", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      text: "See /tmp/example.ts:1767 for details.",
    }),
  );

  expect(html).toContain('class="markdown-file-ref__icon"');
  expect(html).toContain("typescript");
  expect(html).toContain("example.ts (line 1767)");
  expect(html).toContain('title="/tmp/example.ts:1767"');
});

test("renders fenced code blocks with language header", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      text: ["```json", '{"ok":true}', "```"].join("\n"),
    }),
  );

  expect(html).toContain("markdown-code-block");
  expect(html).toContain("markdown-code-block__language");
  expect(html).toContain("markdown-code-block__toolbar");
  expect(html).toContain(">json<");
  expect(html).toContain("language-json");
});

test("defaults unlabeled fences to text", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      text: ["```", "4 pass", "0 fail", "```"].join("\n"),
    }),
  );

  expect(html).toContain("markdown-code-block__language");
  expect(html).toContain(">text<");
});

test("keeps web markdown links external", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      text: "[Docs](https://example.com/docs)",
    }),
  );

  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noreferrer noopener"');
});

test("turns soft newlines into a single break between file refs", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      text: ["相关文件：", "/tmp/platform.ts", "/tmp/douyinSession.ts"].join("\n"),
    }),
  );

  expect(html).toContain("markdown-file-ref");
  expect(html).toContain("platform.ts");
  expect(html).toContain("douyinSession.ts");
  expect((html.match(/<br\s*\/?>/g) ?? []).length).toBe(2);
  expect(html).not.toMatch(/<br\s*\/?>\s*<br\s*\/?>/);
});
