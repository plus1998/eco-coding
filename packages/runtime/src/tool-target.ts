export interface SdkReadToolTarget {
  filePath: string;
  offset?: number;
  limit?: number;
}

export interface SdkGrepToolTarget {
  pattern: string;
  path?: string;
  glob?: string;
  outputMode?: string;
  contextBefore?: number;
  contextAfter?: number;
  contextAround?: number;
  headLimit?: number;
  multiline?: boolean;
  type?: string;
}

const READ_TOOL_NAMES = new Set(["read", "notebookread"]);

export function isReadToolName(toolName: string): boolean {
  return READ_TOOL_NAMES.has(toolName.trim().toLowerCase());
}

export function resolveReadTargetFromToolInput(
  toolName: string,
  input: unknown,
): SdkReadToolTarget | undefined {
  if (!READ_TOOL_NAMES.has(toolName.trim().toLowerCase()) || !isRecord(input)) {
    return undefined;
  }
  const filePath =
    readString(input.file_path) ??
    readString(input.filePath) ??
    readString(input.path) ??
    readString(input.notebook_path) ??
    readString(input.notebookPath);
  if (!filePath) {
    return undefined;
  }
  const offset = readPositiveInt(input.offset);
  const limit = readPositiveInt(input.limit);
  return {
    filePath,
    ...(offset !== undefined && { offset }),
    ...(limit !== undefined && { limit }),
  };
}

export function resolveGrepTargetFromToolInput(
  toolName: string,
  input: unknown,
): SdkGrepToolTarget | undefined {
  if (toolName.trim().toLowerCase() !== "grep" || !isRecord(input)) {
    return undefined;
  }
  const pattern = readString(input.pattern);
  if (!pattern) {
    return undefined;
  }
  const path =
    readString(input.path) ??
    readString(input.file_path) ??
    readString(input.filePath);
  const glob = readString(input.glob);
  const outputMode = readString(input.output_mode) ?? readString(input.outputMode);
  const contextBefore = readNonNegativeInt(input["-B"]) ?? readNonNegativeInt(input.context_before);
  const contextAfter = readNonNegativeInt(input["-A"]) ?? readNonNegativeInt(input.context_after);
  const contextAround = readNonNegativeInt(input["-C"]) ?? readNonNegativeInt(input.context_around);
  const headLimit = readPositiveInt(input.head_limit) ?? readPositiveInt(input.headLimit);
  const type = readString(input.type);
  const multiline = typeof input.multiline === "boolean" ? input.multiline : undefined;
  return {
    pattern,
    ...(path && { path }),
    ...(glob && { glob }),
    ...(outputMode && { outputMode }),
    ...(contextBefore !== undefined && { contextBefore }),
    ...(contextAfter !== undefined && { contextAfter }),
    ...(contextAround !== undefined && { contextAround }),
    ...(headLimit !== undefined && { headLimit }),
    ...(multiline !== undefined && { multiline }),
    ...(type && { type }),
  };
}

export function formatReadTargetLabel(target: SdkReadToolTarget): string {
  const fileName = pathBasename(target.filePath);
  const lineRange = formatReadLineRange(target.offset, target.limit);
  return lineRange ? `${fileName}:${lineRange}` : fileName;
}

export function formatGrepTargetLabel(target: SdkGrepToolTarget): string {
  const pattern = clampPreview(target.pattern, 80);
  const scope = target.path ? pathBasename(target.path) : target.glob ? `glob:${target.glob}` : undefined;
  if (!scope) {
    return pattern;
  }
  return `${pattern} · ${scope}`;
}

export function formatReadLineRange(offset?: number, limit?: number): string | undefined {
  if (offset === undefined) {
    return undefined;
  }
  if (limit === undefined) {
    return `L${offset}`;
  }
  const end = offset + limit - 1;
  return end <= offset ? `L${offset}` : `L${offset}-${end}`;
}

function pathBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
}

function clampPreview(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1)}…`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const rounded = Math.trunc(value);
  return rounded >= 1 ? rounded : undefined;
}

function readNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const rounded = Math.trunc(value);
  return rounded >= 0 ? rounded : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
