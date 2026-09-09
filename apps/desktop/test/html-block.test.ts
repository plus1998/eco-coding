import { expect, test } from "bun:test";
import MarkdownIt from "markdown-it";
import {
  countHtmlLines,
  extractHtmlDocumentTitle,
  isHtmlContainerClose,
  isHtmlLang,
  openHtmlContainerTag,
  stitchHtmlContainerTokens,
} from "../src/renderer/prosemirror/html-block";

test("isHtmlLang matches html and htm fence params", () => {
  expect(isHtmlLang("html")).toBe(true);
  expect(isHtmlLang("HTML")).toBe(true);
  expect(isHtmlLang("htm")).toBe(true);
  expect(isHtmlLang("html preview")).toBe(true);
  expect(isHtmlLang("typescript")).toBe(false);
  expect(isHtmlLang("")).toBe(false);
});

test("extractHtmlDocumentTitle reads title tag", () => {
  expect(extractHtmlDocumentTitle("<html><title>Demo</title></html>")).toBe("Demo");
  expect(extractHtmlDocumentTitle("<html><head><TITLE>  Spaced  </TITLE></head></html>")).toBe("Spaced");
  expect(extractHtmlDocumentTitle("<div>no title</div>")).toBeUndefined();
});

test("countHtmlLines counts newline-separated content", () => {
  expect(countHtmlLines("")).toBe(0);
  expect(countHtmlLines("one")).toBe(1);
  expect(countHtmlLines("one\ntwo\nthree")).toBe(3);
});

test("openHtmlContainerTag detects unclosed containers only", () => {
  expect(openHtmlContainerTag("<details>\n")).toBe("details");
  expect(openHtmlContainerTag('<div style="color:red">x</div>\n')).toBeNull();
  expect(openHtmlContainerTag("<br>\n")).toBeNull();
  expect(isHtmlContainerClose("</details>\n", "details")).toBe(true);
});

test("stitchHtmlContainerTokens merges details split by blank lines", () => {
  const md = MarkdownIt({ html: true, breaks: true });
  const source = ["<details>", "<summary>Tip</summary>", "", "hidden", "", "</details>"].join("\n");
  const tokens = md.parse(source, {});
  expect(tokens.filter((t) => t.type === "html_block").length).toBeGreaterThan(1);
  const stitched = stitchHtmlContainerTokens(tokens, md);
  const blocks = stitched.filter((t) => t.type === "html_block");
  expect(blocks.length).toBe(1);
  expect(blocks[0]?.content).toContain("<details>");
  expect(blocks[0]?.content).toContain("</details>");
  expect(blocks[0]?.content).toContain("hidden");
});
