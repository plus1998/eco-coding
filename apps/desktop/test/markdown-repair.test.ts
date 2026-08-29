import { expect, test } from "bun:test";
import type { MarkdownTableFixer } from "../src/renderer/markdown-repair";
import {
  createMarkdownTableRepair,
  gfmHeaderSeparatorDetector,
  normalizeColumnCountFixer,
  repairMarkdown,
  splitTableRow,
} from "../src/renderer/markdown-repair";
import { renderFeedMarkdownHtml } from "../src/renderer/prosemirror/feed-markdown";

test("splitTableRow drops delimiter pipes and keeps escaped pipes", () => {
  expect(splitTableRow("Header1 | Header2 | ")).toEqual(["Header1", "Header2"]);
  expect(splitTableRow("| a \\| b | c |")).toEqual(["a \\| b", "c"]);
  expect(splitTableRow("| 1 | 2 | |")).toEqual(["1", "2", ""]);
});

test("repairs inconsistent column counts without dropping extra cells", () => {
  const input = ["Header1 | Header2 | ", "|---|---|", "Value1  | Value2 | Value3"].join("\n");
  expect(repairMarkdown(input)).toBe(
    ["| Header1 | Header2 |  |", "| --- | --- | --- |", "| Value1 | Value2 | Value3 |"].join("\n"),
  );
});

test("pads a short separator so markdown-it can parse the table", () => {
  const input = ["| x | y | z |", "| --- | --- |", "| 1 | 2 |"].join("\n");
  const repaired = repairMarkdown(input);
  expect(repaired).toBe(["| x | y | z |", "| --- | --- | --- |", "| 1 | 2 |  |"].join("\n"));
});

test("preserves alignment markers when widening the separator", () => {
  const input = ["| a | b | c |", "| :--- | ---: |", "| 1 | 2 | 3 |"].join("\n");
  expect(repairMarkdown(input)).toBe(["| a | b | c |", "| :--- | ---: | --- |", "| 1 | 2 | 3 |"].join("\n"));
});

test("leaves a consistent table byte-identical", () => {
  const compact = ["| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
  expect(repairMarkdown(compact)).toBe(compact);
});

test("rewrites the no-leading-pipe case when a body row is wider than the header", () => {
  const input = [" Header1 | Header2 | ", " |---|---|", "  Value1  | Value2 | Value3"].join("\n");
  expect(repairMarkdown(input)).toBe(
    ["| Header1 | Header2 |  |", "| --- | --- | --- |", "| Value1 | Value2 | Value3 |"].join("\n"),
  );
});

test("does not rewrite fenced table examples", () => {
  const input = ["```", "| a | b |", "| --- | --- |", "| 1 | 2 | 3 |", "```"].join("\n");
  expect(repairMarkdown(input)).toBe(input);
});

test("does not invent a separator when it is missing", () => {
  const input = ["| Header1 | Header2 | Header3", "Value1 | Value3"].join("\n");
  expect(repairMarkdown(input)).toBe(input);
});

test("repairs only the broken table in a mixed document", () => {
  const input = [
    "intro",
    "",
    "| a | b |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "| x | y |",
    "| --- | --- |",
    "| 1 | 2 | 3 |",
    "",
    "outro",
  ].join("\n");
  expect(repairMarkdown(input)).toBe(
    [
      "intro",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "| x | y |  |",
      "| --- | --- | --- |",
      "| 1 | 2 | 3 |",
      "",
      "outro",
    ].join("\n"),
  );
});

test("table repair pipeline accepts additional fixers", () => {
  const shoutHeader: MarkdownTableFixer = {
    id: "shout-header",
    apply(table) {
      return { ...table, header: table.header.map((cell) => cell.toUpperCase()) };
    },
  };
  const repair = createMarkdownTableRepair({
    detectors: [gfmHeaderSeparatorDetector],
    fixers: [normalizeColumnCountFixer, shoutHeader],
  });
  const input = ["| a | b |", "| --- | --- |", "| 1 | 2 | 3 |"].join("\n");
  expect(repair.apply(input)).toBe(["| A | B |  |", "| --- | --- | --- |", "| 1 | 2 | 3 |"].join("\n"));
});

test("feed markdown keeps extra table cells after repair", () => {
  const html = renderFeedMarkdownHtml(
    ["Header1 | Header2 | ", "|---|---|", "Value1  | Value2 | Value3"].join("\n"),
  );
  expect(html).toContain("<table");
  expect(html).toContain("Header1");
  expect(html).toContain("Value3");
  expect((html.match(/<th\b/g) ?? []).length).toBe(3);
  expect((html.match(/<td\b/g) ?? []).length).toBe(3);
});

test("feed markdown still skips missing-separator tables", () => {
  const html = renderFeedMarkdownHtml(["| Header1 | Header2 | Header3", "Value1 | Value3"].join("\n"));
  expect(html).not.toContain("<table");
});
