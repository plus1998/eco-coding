import { expect, test } from "bun:test";
import { countHtmlLines, extractHtmlDocumentTitle, isHtmlLang } from "../src/renderer/prosemirror/html-block";

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
