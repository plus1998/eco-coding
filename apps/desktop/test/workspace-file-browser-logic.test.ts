import { expect, test } from "bun:test";
import fs from "node:fs";
import {
  ancestorDirectories,
  basename,
  buildWorkspaceRoot,
  clampTargetColumn,
  clampTargetLine,
  fileExtension,
  itemIndex,
  languageForFile,
  mergeWorkspaceEntries,
} from "../src/renderer/workspace-file-browser-logic";
import { i18nCatalogs } from "../src/shared/i18n-catalogs";

test("normalizes tree item indexes for controlled tree state", () => {
  expect(itemIndex({ index: "/repo/src" })).toBe("/repo/src");
  expect(itemIndex({ index: 42 })).toBe("42");
});

test("keeps WorkspaceFileBrowser translation keys in both catalogs", () => {
  const source = [
    "../src/renderer/WorkspaceFileBrowser.tsx",
    "../src/renderer/WorkspaceFileViewer.tsx",
    "../src/renderer/SubagentTaskDrawer.tsx",
  ].map((relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), "utf8")).join("\n");
  const keys = [...source.matchAll(/t\("([^"]+)"/g)]
    .map((match) => match[1])
    .filter(
      (key): key is string =>
        key?.startsWith("fileBrowser.") === true || key?.startsWith("fileViewer.") === true,
    );
  const uniqueKeys = [...new Set(keys)];

  for (const key of uniqueKeys) {
    expect(i18nCatalogs["zh-CN"].translation[key as keyof typeof i18nCatalogs["zh-CN"]["translation"]]).toBeDefined();
    expect(i18nCatalogs["en-US"].translation[key as keyof typeof i18nCatalogs["en-US"]["translation"]]).toBeDefined();
  }
});

test("derives common file language and extension", () => {
  expect(fileExtension("/repo/src/App.TSX")).toBe("tsx");
  expect(languageForFile("/repo/src/App.TSX")).toBe("tsx");
  expect(languageForFile("/repo/README")).toBeUndefined();
});

test("clamps target lines to the document", () => {
  expect(clampTargetLine(0, 4)).toBe(1);
  expect(clampTargetLine(9, 4)).toBe(4);
  expect(clampTargetLine(2.9, 4)).toBe(2);
  expect(clampTargetLine(undefined, 4)).toBeUndefined();
});

test("clamps target columns to the selected line", () => {
  expect(clampTargetColumn(0, 8)).toBe(1);
  expect(clampTargetColumn(20, 8)).toBe(8);
  expect(clampTargetColumn(4.9, 8)).toBe(4);
  expect(clampTargetColumn(undefined, 8)).toBeUndefined();
});

test("builds and merges a sorted lazy tree", () => {
  const root = "/repo";
  const items = mergeWorkspaceEntries(buildWorkspaceRoot(root), root, [
    { name: "z.ts", path: "/repo/z.ts", kind: "file" },
    { name: "src", path: "/repo/src", kind: "directory" },
  ]);
  expect(items[root]?.children).toEqual(["/repo/src", "/repo/z.ts"]);
  expect(items["/repo/src"]?.isFolder).toBe(true);
});

test("returns ancestor directories in loading order", () => {
  expect(ancestorDirectories("/repo", "/repo/src/lib/file.ts")).toEqual(["/repo/src", "/repo/src/lib"]);
  expect(basename("/repo/")).toBe("repo");
});
