export type FileChangePreviewLineKind = "add" | "remove" | "context";

export interface FileChangePreviewLine {
  kind: FileChangePreviewLineKind;
  text: string;
}

export interface ThreadRunFileChangeMetadata {
  path: string;
  additions: number;
  deletions: number;
  previewLines: FileChangePreviewLine[];
}

export interface FileChangeCardDisplay {
  fileName: string;
  path: string;
  additions: number;
  deletions: number;
  previewLines: FileChangePreviewLine[];
}

const FILE_CHANGE_TOOLS = new Set(["edit", "write", "multiedit", "notebookedit"]);

export function isFileChangeToolName(toolName: string): boolean {
  return FILE_CHANGE_TOOLS.has(toolName.trim().toLowerCase());
}

export function resolveFileChangeFromToolInput(
  toolName: string,
  input: unknown,
): ThreadRunFileChangeMetadata | undefined {
  const normalized = toolName.trim().toLowerCase();
  if (!FILE_CHANGE_TOOLS.has(normalized) || !isRecord(input)) {
    return undefined;
  }

  if (normalized === "multiedit" && Array.isArray(input.edits)) {
    for (const edit of input.edits) {
      if (!isRecord(edit)) {
        continue;
      }
      const resolved = buildEditFileChange(
        readString(edit.file_path) ?? readString(edit.path),
        readString(edit.old_string),
        readString(edit.new_string),
      );
      if (resolved) {
        return resolved;
      }
    }
    return undefined;
  }

  const filePath = readString(input.file_path) ?? readString(input.path) ?? readString(input.notebook_path);
  if (!filePath) {
    return undefined;
  }

  if (normalized === "write") {
    return buildWriteFileChange(filePath, readString(input.content) ?? "");
  }

  if (normalized === "notebookedit") {
    return buildWriteFileChange(filePath, readString(input.new_source) ?? readString(input.source) ?? "");
  }

  const fromEdits = buildEditFileChangeFromPiEdits(filePath, input.edits);
  if (fromEdits) {
    return fromEdits;
  }

  return buildEditFileChange(
    filePath,
    readString(input.old_string) ?? readString(input.oldText) ?? readString(input.old_text),
    readString(input.new_string) ?? readString(input.newText) ?? readString(input.new_text),
  );
}

export function enrichFileChangeFromToolOutput(
  existing: ThreadRunFileChangeMetadata | undefined,
  output: unknown,
): ThreadRunFileChangeMetadata | undefined {
  const fromAcpDiff = fileChangeFromAcpDiffContent(output, existing?.path);
  if (fromAcpDiff && fromAcpDiff.previewLines.length > 0) {
    return fromAcpDiff;
  }

  const record = parseToolOutputRecord(output);
  if (!record) {
    return existing;
  }

  // ACP-style content may also be nested under a tool-result record.
  const nestedContent = record.content ?? record.contents;
  const fromNestedAcp = fileChangeFromAcpDiffContent(nestedContent, existing?.path);
  if (fromNestedAcp && fromNestedAcp.previewLines.length > 0) {
    return fromNestedAcp;
  }

  const filePath =
    readString(record.filePath) ??
    readString(record.file_path) ??
    readString(record.notebook_path) ??
    existing?.path;
  if (!filePath) {
    return existing;
  }

  const gitDiff = isRecord(record.gitDiff) ? record.gitDiff : undefined;
  const structuredPatch = Array.isArray(record.structuredPatch) ? record.structuredPatch : undefined;
  const fromPatch = structuredPatch ? fileChangeFromStructuredPatch(structuredPatch) : undefined;

  const additions =
    typeof gitDiff?.additions === "number"
      ? gitDiff.additions
      : (fromPatch?.additions ?? existing?.additions ?? 0);
  const deletions =
    typeof gitDiff?.deletions === "number"
      ? gitDiff.deletions
      : (fromPatch?.deletions ?? existing?.deletions ?? 0);
  const previewLines =
    fromPatch && fromPatch.previewLines.length > 0 ? fromPatch.previewLines : (existing?.previewLines ?? []);

  if (previewLines.length === 0 && additions === 0 && deletions === 0) {
    return existing;
  }

  return {
    path: filePath,
    additions,
    deletions,
    previewLines,
  };
}

/**
 * ACP tool_call content blocks: `{ type: "diff", path, oldText, newText }`.
 * Also accepts the nested `{ type: "content", content: { type: "diff", ... } }` form.
 */
function fileChangeFromAcpDiffContent(
  output: unknown,
  fallbackPath?: string,
): ThreadRunFileChangeMetadata | undefined {
  const diffs = collectAcpDiffBlocks(output);
  if (diffs.length === 0) {
    return undefined;
  }

  const filePath =
    diffs.find((entry) => entry.path)?.path ??
    (typeof fallbackPath === "string" && fallbackPath.trim() ? fallbackPath.trim() : undefined);
  if (!filePath) {
    return undefined;
  }

  const hasOld = diffs.some((entry) => entry.oldText !== undefined);
  const hasNew = diffs.some((entry) => entry.newText !== undefined);
  if (!hasOld && !hasNew) {
    return undefined;
  }

  return buildEditFileChange(
    filePath,
    hasOld ? diffs.map((entry) => entry.oldText ?? "").join("\n") : "",
    hasNew ? diffs.map((entry) => entry.newText ?? "").join("\n") : "",
  );
}

type AcpDiffBlock = {
  path?: string;
  oldText?: string | null;
  newText?: string | null;
};

function collectAcpDiffBlocks(content: unknown): AcpDiffBlock[] {
  if (Array.isArray(content)) {
    const blocks: AcpDiffBlock[] = [];
    for (const entry of content) {
      const block = readAcpDiffBlock(entry);
      if (block) {
        blocks.push(block);
      }
    }
    return blocks;
  }
  const single = readAcpDiffBlock(content);
  return single ? [single] : [];
}

function readAcpDiffBlock(value: unknown): AcpDiffBlock | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.type === "diff") {
    return normalizeAcpDiffBlock(value);
  }
  if (value.type === "content" && isRecord(value.content) && value.content.type === "diff") {
    return normalizeAcpDiffBlock(value.content);
  }
  return undefined;
}

function normalizeAcpDiffBlock(value: Record<string, unknown>): AcpDiffBlock | undefined {
  const path = readString(value.path) ?? readString(value.file_path) ?? readString(value.filePath);
  const hasOld = "oldText" in value || "old_text" in value || "old_string" in value;
  const hasNew = "newText" in value || "new_text" in value || "new_string" in value;
  if (!path && !hasOld && !hasNew) {
    return undefined;
  }
  return {
    ...(path ? { path } : {}),
    ...(hasOld ? { oldText: readNullableDiffText(value.oldText ?? value.old_text ?? value.old_string) } : {}),
    ...(hasNew ? { newText: readNullableDiffText(value.newText ?? value.new_text ?? value.new_string) } : {}),
  };
}

function readNullableDiffText(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return typeof value === "string" ? value : null;
}

export function resolveFileChangeCardDisplay(
  metadata: ThreadRunFileChangeMetadata | undefined,
): FileChangeCardDisplay | undefined {
  if (!metadata || metadata.previewLines.length === 0) {
    return undefined;
  }
  const normalizedPath = metadata.path.replace(/\\/g, "/");
  const fileName = normalizedPath.split("/").pop() || metadata.path;
  return {
    fileName,
    path: metadata.path,
    additions: metadata.additions,
    deletions: metadata.deletions,
    previewLines: metadata.previewLines,
  };
}

export function parseThreadRunFileChangeMetadata(value: unknown): ThreadRunFileChangeMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const path = readString(value.path);
  if (!path) {
    return undefined;
  }
  const additions =
    typeof value.additions === "number" && Number.isFinite(value.additions) ? value.additions : 0;
  const deletions =
    typeof value.deletions === "number" && Number.isFinite(value.deletions) ? value.deletions : 0;
  const previewLines = parsePreviewLines(value.previewLines);
  return { path, additions, deletions, previewLines };
}

function parsePreviewLines(value: unknown): FileChangePreviewLine[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const lines: FileChangePreviewLine[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.text !== "string") {
      continue;
    }
    const kind = entry.kind;
    if (kind !== "add" && kind !== "remove" && kind !== "context") {
      continue;
    }
    lines.push({ kind, text: entry.text });
  }
  return lines;
}

function buildEditFileChangeFromPiEdits(
  filePath: string,
  edits: unknown,
): ThreadRunFileChangeMetadata | undefined {
  if (!Array.isArray(edits) || edits.length === 0) {
    return undefined;
  }
  const oldParts: string[] = [];
  const newParts: string[] = [];
  for (const edit of edits) {
    if (!isRecord(edit)) {
      continue;
    }
    const oldText = readString(edit.oldText) ?? readString(edit.old_string) ?? readString(edit.old_text);
    const newText = readString(edit.newText) ?? readString(edit.new_string) ?? readString(edit.new_text);
    if (oldText !== undefined) {
      oldParts.push(oldText);
    }
    if (newText !== undefined) {
      newParts.push(newText);
    }
  }
  if (oldParts.length === 0 && newParts.length === 0) {
    return undefined;
  }
  return buildEditFileChange(filePath, oldParts.join("\n"), newParts.join("\n"));
}

function buildEditFileChange(
  filePath: string | undefined,
  oldString: string | undefined,
  newString: string | undefined,
): ThreadRunFileChangeMetadata | undefined {
  if (!filePath) {
    return undefined;
  }
  const oldLines = splitContentLines(oldString ?? "");
  const newLines = splitContentLines(newString ?? "");
  const previewLines: FileChangePreviewLine[] = [
    ...oldLines.map((text) => ({ kind: "remove" as const, text })),
    ...newLines.map((text) => ({ kind: "add" as const, text })),
  ];
  if (previewLines.length === 0) {
    return undefined;
  }
  return {
    path: filePath,
    additions: newLines.length,
    deletions: oldLines.length,
    previewLines,
  };
}

function buildWriteFileChange(filePath: string, content: string): ThreadRunFileChangeMetadata | undefined {
  const lines = splitContentLines(content);
  if (lines.length === 0) {
    return undefined;
  }
  return {
    path: filePath,
    additions: lines.length,
    deletions: 0,
    previewLines: lines.map((text) => ({ kind: "add" as const, text })),
  };
}

function fileChangeFromStructuredPatch(
  patch: readonly unknown[],
): Pick<ThreadRunFileChangeMetadata, "additions" | "deletions" | "previewLines"> {
  const previewLines: FileChangePreviewLine[] = [];
  let additions = 0;
  let deletions = 0;

  for (const hunk of patch) {
    if (!isRecord(hunk) || !Array.isArray(hunk.lines)) {
      continue;
    }
    for (const rawLine of hunk.lines) {
      if (typeof rawLine !== "string" || rawLine.length === 0) {
        continue;
      }
      const marker = rawLine[0];
      const text = rawLine.slice(1);
      if (marker === "+") {
        additions += 1;
        previewLines.push({ kind: "add", text });
      } else if (marker === "-") {
        deletions += 1;
        previewLines.push({ kind: "remove", text });
      } else if (marker === " ") {
        previewLines.push({ kind: "context", text });
      }
    }
  }

  return { additions, deletions, previewLines };
}

function parseToolOutputRecord(output: unknown): Record<string, unknown> | undefined {
  if (isRecord(output)) {
    return output;
  }
  if (typeof output !== "string") {
    return undefined;
  }
  const trimmed = output.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function splitContentLines(content: string): string[] {
  if (!content) {
    return [];
  }
  return content.replace(/\r\n/g, "\n").split("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
