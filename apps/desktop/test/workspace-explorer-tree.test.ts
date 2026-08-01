import { expect, test } from "bun:test";
import { splitFileLabelName } from "../src/renderer/WorkspaceExplorerTree";

test("splitFileLabelName keeps the last extension for truncation", () => {
  expect(splitFileLabelName("WorkspaceFileBrowser.tsx")).toEqual({
    stem: "WorkspaceFileBrowser",
    ext: ".tsx",
  });
  expect(splitFileLabelName("package.json")).toEqual({
    stem: "package",
    ext: ".json",
  });
  expect(splitFileLabelName("archive.tar.gz")).toEqual({
    stem: "archive.tar",
    ext: ".gz",
  });
});

test("splitFileLabelName leaves folders and dotfiles intact", () => {
  expect(splitFileLabelName("apps/desktop", true)).toEqual({
    stem: "apps/desktop",
    ext: "",
  });
  expect(splitFileLabelName(".gitignore")).toEqual({
    stem: ".gitignore",
    ext: "",
  });
  expect(splitFileLabelName("Makefile")).toEqual({
    stem: "Makefile",
    ext: "",
  });
});
