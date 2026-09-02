import { expect, test } from "bun:test";
import { fileToDisplayHunks, flattenDisplayLines } from "../src/renderer/diff-display-lines";
import {
  highlightDiffDisplayLines,
  resolveShikiLanguage,
  themedTokensToHtml,
} from "../src/renderer/diff-shiki-highlight";
import { parseDiff } from "../src/renderer/prosemirror/diff-from-patch";

const typescriptPatch = [
  "diff --git a/src/example.ts b/src/example.ts",
  "index 1111111..2222222 100644",
  "--- a/src/example.ts",
  "+++ b/src/example.ts",
  "@@ -1 +1 @@",
  "-const value: number = 1;",
  "+const value: number = 2;",
].join("\n");

test("resolveShikiLanguage aliases shell extensions", () => {
  expect(resolveShikiLanguage("src/App.tsx")).toBe("tsx");
  expect(resolveShikiLanguage("scripts/run.sh")).toBe("shellscript");
  expect(resolveShikiLanguage("README.md")).toBe("markdown");
  expect(resolveShikiLanguage("assets/logo.bin")).toBe("plaintext");
});

test("themedTokensToHtml escapes content and applies color", () => {
  const html = themedTokensToHtml([{ content: "<x>", offset: 0, color: "#ff0000", fontStyle: 0 }]);
  expect(html).toContain("&lt;x&gt;");
  expect(html).toContain("color:#ff0000");
});

test("highlightDiffDisplayLines tokenizes insert and delete sides", async () => {
  const file = parseDiff(typescriptPatch)[0]!;
  const lines = flattenDisplayLines(fileToDisplayHunks(file));
  const htmls = await highlightDiffDisplayLines(lines, "typescript", "light");
  expect(htmls).toHaveLength(2);
  expect(htmls[0]).toContain("span");
  expect(htmls[0]).toContain("const");
  expect(htmls[1]).toContain("span");
  expect(htmls[1]).toContain("const");
}, 30_000);
