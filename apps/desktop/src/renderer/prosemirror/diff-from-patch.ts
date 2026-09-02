import parser, { type Change, type File } from "gitdiff-parser";
import type { Node as PMNode } from "prosemirror-model";
import { createEmptyDiffDoc, type DiffLineKind, diffViewerSchema } from "./diff-viewer-schema";

function isDelete(change: Change): change is Extract<Change, { type: "delete" }> {
  return change.type === "delete";
}

function isInsert(change: Change): change is Extract<Change, { type: "insert" }> {
  return change.type === "insert";
}

function zipChanges(changes: Change[]): Change[] {
  const result: Change[] = [];
  let last: Change | undefined;
  let lastDeletionIndex = -1;

  for (const change of changes) {
    if (!last) {
      result.push(change);
      last = change;
      if (isDelete(change)) lastDeletionIndex = 0;
      continue;
    }

    if (isInsert(change) && lastDeletionIndex >= 0) {
      result.splice(lastDeletionIndex + 1, 0, change);
      last = change;
      lastDeletionIndex += 1;
      continue;
    }

    result.push(change);
    if (isDelete(change) && !isDelete(last)) {
      lastDeletionIndex = result.length - 1;
    }
    last = change;
  }

  return result;
}

function normalizeDiffText(text: string): string {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("diff --git")) return trimmed;
  const firstBreak = trimmed.indexOf("\n");
  const secondBreak = trimmed.indexOf("\n", firstBreak + 1);
  if (firstBreak < 0 || secondBreak < 0) return trimmed;
  const oldPath = trimmed.slice(0, firstBreak).split(" ").slice(1, -3).join(" ");
  const newPath = trimmed
    .slice(firstBreak + 1, secondBreak)
    .split(" ")
    .slice(1, -3)
    .join(" ");
  return [
    `diff --git a/${oldPath} b/${newPath}`,
    "index 1111111..2222222 100644",
    `--- a/${oldPath}`,
    `+++ b/${newPath}`,
    trimmed.slice(secondBreak + 1),
  ].join("\n");
}

export function parseDiff(text: string): File[] {
  const files = parser.parse(normalizeDiffText(text));
  return files.map((file) => ({
    ...file,
    hunks: file.hunks.map((hunk) => ({
      ...hunk,
      changes: zipChanges(hunk.changes),
    })),
  }));
}

export function diffFilePath(file: File): string {
  const raw = file.newPath === "/dev/null" ? file.oldPath : file.newPath;
  return raw.startsWith("b/") ? raw.slice(2) : raw;
}

export function resolveDiffFilePath(file: File): string {
  return diffFilePath(file);
}

export function resolveDiffLanguage(path: string): string | undefined {
  const fileName = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (fileName === "dockerfile") return "shell";
  const extension = fileName.includes(".") ? fileName.split(".").at(-1) : undefined;
  const languageByExtension: Readonly<Record<string, string>> = {
    cjs: "javascript",
    css: "css",
    go: "go",
    htm: "html",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "jsx",
    md: "markdown",
    mdx: "markdown",
    mjs: "javascript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "shell",
    sql: "sql",
    ts: "typescript",
    tsx: "tsx",
    yaml: "yaml",
    yml: "yaml",
    zsh: "shell",
  };
  return extension ? languageByExtension[extension] : undefined;
}

export function countDiffFileStats(file: File): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    for (const change of hunk.changes) {
      if (isInsert(change)) additions += 1;
      else if (isDelete(change)) deletions += 1;
    }
  }
  return { additions, deletions };
}

function changeLineAttrs(change: Change): {
  kind: DiffLineKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
} {
  if (isInsert(change)) {
    return {
      kind: "insert",
      oldNo: null,
      newNo: change.lineNumber,
      text: change.content,
    };
  }
  if (isDelete(change)) {
    return {
      kind: "delete",
      oldNo: change.lineNumber,
      newNo: null,
      text: change.content,
    };
  }
  return {
    kind: "context",
    oldNo: change.oldLineNumber,
    newNo: change.newLineNumber,
    text: change.content,
  };
}

export function buildDiffDocFromFile(file: File): PMNode {
  const hunkNodes = file.hunks.map((hunk) => {
    const lines = hunk.changes.map((change) => diffViewerSchema.node("diff_line", changeLineAttrs(change)));
    return diffViewerSchema.node("hunk", null, lines);
  });
  if (hunkNodes.length === 0) return createEmptyDiffDoc();
  return diffViewerSchema.node("doc", null, hunkNodes);
}

export function buildDiffDocFromPatch(patch: string, selectedPath?: string): PMNode | null {
  const trimmed = patch.trim();
  if (!trimmed) return null;
  let files: File[];
  try {
    files = parseDiff(trimmed);
  } catch {
    return null;
  }
  const visible = selectedPath ? files.filter((file) => diffFilePath(file) === selectedPath) : files;
  if (visible.length === 0) return null;
  // Review shows one selected file; multiple files only when no selection.
  if (visible.length === 1) return buildDiffDocFromFile(visible[0]!);
  const hunks: PMNode[] = [];
  for (const file of visible) {
    const doc = buildDiffDocFromFile(file);
    doc.forEach((child) => {
      hunks.push(child);
    });
  }
  return hunks.length === 0 ? createEmptyDiffDoc() : diffViewerSchema.node("doc", null, hunks);
}

export function collectDiffLineTexts(doc: PMNode): Array<{ kind: DiffLineKind; text: string }> {
  const rows: Array<{ kind: DiffLineKind; text: string }> = [];
  doc.forEach((hunk) => {
    hunk.forEach((line) => {
      rows.push({
        kind: String(line.attrs.kind) as DiffLineKind,
        text: String(line.attrs.text ?? ""),
      });
    });
  });
  return rows;
}
