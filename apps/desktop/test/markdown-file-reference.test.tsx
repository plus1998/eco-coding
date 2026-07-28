import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownContent } from "../src/renderer/MarkdownContent";

test("renders absolute markdown file links as internal links", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      text: "[App.tsx](/repo/src/App.tsx:12:3)",
    }),
  );

  expect(html).toContain('href="/repo/src/App.tsx:12:3"');
  expect(html).not.toContain('target="_blank"');
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
