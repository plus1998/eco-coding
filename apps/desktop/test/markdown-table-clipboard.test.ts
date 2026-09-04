import { expect, test } from "bun:test";
import {
  tableMatrixToCsv,
  tableMatrixToExcelXml,
  tableMatrixToHtml,
  tableMatrixToMarkdown,
} from "../src/renderer/markdown-table-clipboard";

test("tableMatrixToMarkdown emits GFM with padded columns", () => {
  expect(
    tableMatrixToMarkdown([
      ["a", "b"],
      ["1", "2", "3"],
    ]),
  ).toBe(["| a | b |  |", "| --- | --- | --- |", "| 1 | 2 | 3 |"].join("\n"));
});

test("tableMatrixToMarkdown escapes pipes", () => {
  expect(
    tableMatrixToMarkdown([
      ["a|b", "c"],
      ["1", "2"],
    ]),
  ).toBe(["| a\\|b | c |", "| --- | --- |", "| 1 | 2 |"].join("\n"));
});

test("tableMatrixToHtml emits a clean table", () => {
  expect(
    tableMatrixToHtml([
      ["Name", "Value"],
      ["alpha", "1"],
    ]),
  ).toBe(
    "<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>alpha</td><td>1</td></tr></tbody></table>",
  );
});

test("tableMatrixToHtml escapes markup in cells", () => {
  expect(
    tableMatrixToHtml([
      ["<b>", "x"],
      ["a&b", '"'],
    ]),
  ).toBe(
    "<table><thead><tr><th>&lt;b&gt;</th><th>x</th></tr></thead><tbody><tr><td>a&amp;b</td><td>&quot;</td></tr></tbody></table>",
  );
});

test("tableMatrixToCsv emits UTF-8 BOM and RFC 4180 cells", () => {
  const csv = tableMatrixToCsv([
    ["Name", "Note"],
    ["alpha", 'say "hi"'],
    ["a,b", "line\nbreak"],
  ]);
  expect(csv.startsWith("\uFEFF")).toBe(true);
  expect(csv.slice(1)).toBe(
    ['Name,Note', 'alpha,"say ""hi"""', '"a,b","line\nbreak"'].join("\r\n"),
  );
});

test("tableMatrixToCsv pads short rows", () => {
  expect(tableMatrixToCsv([["a", "b"], ["1"]]).slice(1)).toBe("a,b\r\n1,");
});

test("tableMatrixToExcelXml emits SpreadsheetML workbook", () => {
  const xml = tableMatrixToExcelXml([
    ["Name", "Value"],
    ["a&b", "<x>"],
  ]);
  expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>');
  expect(xml).toContain("<Worksheet ss:Name=\"Sheet1\">");
  expect(xml).toContain("<Data ss:Type=\"String\">Name</Data>");
  expect(xml).toContain("<Data ss:Type=\"String\">a&amp;b</Data>");
  expect(xml).toContain("<Data ss:Type=\"String\">&lt;x&gt;</Data>");
});

test("tableMatrixToExcelXml returns empty for empty matrix", () => {
  expect(tableMatrixToExcelXml([])).toBe("");
});
