import { expect, test } from "bun:test";
import {
  enrichFileChangeFromToolOutput,
  parseThreadRunFileChangeMetadata,
  resolveFileChangeCardDisplay,
  resolveFileChangeFromToolInput,
} from "../src/shared/file-change";

test("resolveFileChangeFromToolInput builds edit preview with +/- counts", () => {
  const change = resolveFileChangeFromToolInput("Edit", {
    file_path: "/repo/lib/composer_controls.dart",
    old_string: "final old = 1;\nfinal removed = 2;",
    new_string: "final updated = 3;\nfinal added = 4;",
  });

  expect(change).toEqual({
    path: "/repo/lib/composer_controls.dart",
    additions: 2,
    deletions: 2,
    previewLines: [
      { kind: "remove", text: "final old = 1;" },
      { kind: "remove", text: "final removed = 2;" },
      { kind: "add", text: "final updated = 3;" },
      { kind: "add", text: "final added = 4;" },
    ],
  });
});

test("resolveFileChangeFromToolInput builds write preview as additions only", () => {
  const change = resolveFileChangeFromToolInput("Write", {
    file_path: "/repo/README.md",
    content: "# Title\n\nBody",
  });

  expect(change?.additions).toBe(3);
  expect(change?.deletions).toBe(0);
  expect(change?.previewLines.every((line) => line.kind === "add")).toBe(true);
});

test("resolveFileChangeFromToolInput maps PI edit edits[].oldText/newText", () => {
  const change = resolveFileChangeFromToolInput("edit", {
    path: "/repo/apps/desktop/src/main/thread-run-outcome.ts",
    edits: [
      {
        oldText: '  return { kind: "idle", message: "计划阶段已结束。" };',
        newText: '  return { kind: "completed" };',
      },
    ],
  });

  expect(change?.path).toBe("/repo/apps/desktop/src/main/thread-run-outcome.ts");
  expect(change?.deletions).toBe(1);
  expect(change?.additions).toBe(1);
  expect(change?.previewLines).toEqual([
    { kind: "remove", text: '  return { kind: "idle", message: "计划阶段已结束。" };' },
    { kind: "add", text: '  return { kind: "completed" };' },
  ]);
});

test("resolveFileChangeFromToolInput maps PI write path+content", () => {
  const change = resolveFileChangeFromToolInput("write", {
    path: "test.log",
    content: "Final: 5\nhi",
  });
  expect(change?.path).toBe("test.log");
  expect(change?.additions).toBe(2);
  expect(change?.previewLines.map((line) => line.text)).toEqual(["Final: 5", "hi"]);
});

test("enrichFileChangeFromToolOutput prefers structured patch output", () => {
  const enriched = enrichFileChangeFromToolOutput(undefined, {
    filePath: "/repo/lib/main.dart",
    structuredPatch: [
      {
        lines: ["-old line", "+new line"],
      },
    ],
    gitDiff: {
      additions: 1,
      deletions: 1,
    },
  });

  expect(enriched).toEqual({
    path: "/repo/lib/main.dart",
    additions: 1,
    deletions: 1,
    previewLines: [
      { kind: "remove", text: "old line" },
      { kind: "add", text: "new line" },
    ],
  });
});

test("resolveFileChangeCardDisplay exposes basename and preview", () => {
  const display = resolveFileChangeCardDisplay({
    path: "/repo/lib/composer_controls.dart",
    additions: 2,
    deletions: 1,
    previewLines: [{ kind: "add", text: "final x = 1;" }],
  });

  expect(display).toEqual({
    fileName: "composer_controls.dart",
    path: "/repo/lib/composer_controls.dart",
    additions: 2,
    deletions: 1,
    previewLines: [{ kind: "add", text: "final x = 1;" }],
  });
});

test("parseThreadRunFileChangeMetadata round-trips projection metadata", () => {
  const parsed = parseThreadRunFileChangeMetadata({
    path: "/repo/a.ts",
    additions: 1,
    deletions: 0,
    previewLines: [{ kind: "add", text: "export {}" }],
  });

  expect(parsed?.path).toBe("/repo/a.ts");
  expect(parsed?.previewLines).toHaveLength(1);
});

test("enrichFileChangeFromToolOutput maps ACP diff content blocks", () => {
  const enriched = enrichFileChangeFromToolOutput(undefined, [
    {
      type: "diff",
      path: "/repo/src/app.ts",
      oldText: "const a = 1;",
      newText: "const a = 2;",
    },
  ]);

  expect(enriched).toEqual({
    path: "/repo/src/app.ts",
    additions: 1,
    deletions: 1,
    previewLines: [
      { kind: "remove", text: "const a = 1;" },
      { kind: "add", text: "const a = 2;" },
    ],
  });
});

test("enrichFileChangeFromToolOutput maps nested ACP content.diff and null oldText", () => {
  const enriched = enrichFileChangeFromToolOutput(
    { path: "/repo/src/new.ts", additions: 0, deletions: 0, previewLines: [] },
    [
      {
        type: "content",
        content: {
          type: "diff",
          path: "/repo/src/new.ts",
          oldText: null,
          newText: "export {};",
        },
      },
    ],
  );

  expect(enriched?.path).toBe("/repo/src/new.ts");
  expect(enriched?.deletions).toBe(0);
  expect(enriched?.additions).toBe(1);
  expect(enriched?.previewLines).toEqual([{ kind: "add", text: "export {};" }]);
});

test("resolveFileChangeFromToolInput maps ACP-folded oldText/newText on Edit", () => {
  const change = resolveFileChangeFromToolInput("Edit", {
    path: "/repo/src/app.ts",
    file_path: "/repo/src/app.ts",
    oldText: "a",
    newText: "b",
  });
  expect(change?.previewLines).toEqual([
    { kind: "remove", text: "a" },
    { kind: "add", text: "b" },
  ]);
});
