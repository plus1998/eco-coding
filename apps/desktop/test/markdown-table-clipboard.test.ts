import { expect, test } from "bun:test";
import { tableMatrixToHtml, tableMatrixToMarkdown } from "../src/renderer/markdown-table-clipboard";

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
