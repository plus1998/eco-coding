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
