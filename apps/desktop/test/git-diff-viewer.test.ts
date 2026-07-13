import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GitDiffViewer, resolveDiffLanguage } from "../src/renderer/GitDiffViewer";

const typescriptPatch = [
  "diff --git a/src/example.ts b/src/example.ts",
  "index 1111111..2222222 100644",
  "--- a/src/example.ts",
  "+++ b/src/example.ts",
  "@@ -1 +1 @@",
  "-const value: number = 1;",
  "+const value: number = 2;",
].join("\n");

test("resolveDiffLanguage maps common review file extensions", () => {
  expect(resolveDiffLanguage("src/App.tsx")).toBe("tsx");
  expect(resolveDiffLanguage("scripts/release.sh")).toBe("bash");
  expect(resolveDiffLanguage("README.md")).toBe("markdown");
  expect(resolveDiffLanguage("assets/logo.bin")).toBeUndefined();
});

test("GitDiffViewer renders syntax tokens, inline edits, and layout controls", () => {
  const html = renderToStaticMarkup(
    createElement(GitDiffViewer, {
      patch: typescriptPatch,
      selectedPath: "src/example.ts",
    }),
  );

  expect(html).toContain("workspace-diff-file-toolbar");
  expect(html).toContain("workspace-diff-code-scroll");
  expect(html).toContain("代码对比布局");
  expect(html).toContain("自适应");
  expect(html).toContain("单栏");
  expect(html).toContain("并排");
  expect(html).toContain("token keyword");
  expect(html).toContain("diff-code-edit");
});
