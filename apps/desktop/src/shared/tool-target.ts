import {
  formatGrepTargetLabel,
  formatReadLineRange,
  formatReadTargetLabel,
  resolveGrepTargetFromToolInput,
  resolveReadTargetFromToolInput,
  type SdkGrepToolTarget,
  type SdkReadToolTarget,
} from "@eco/runtime/tool-target";

export type { SdkGrepToolTarget as ThreadRunGrepToolTarget, SdkReadToolTarget as ThreadRunReadToolTarget };

export interface ReadToolTargetDisplay {
  fileName: string;
  filePath: string;
  offset?: number;
  limit?: number;
  lineRange?: string;
}

export interface GrepToolTargetDisplay {
  pattern: string;
  path?: string;
  glob?: string;
  scopeLabel?: string;
}

export function formatThreadRunToolDetailLabel(tool: {
  name: string;
  detail?: string;
  readTarget?: SdkReadToolTarget;
  grepTarget?: SdkGrepToolTarget;
}): string | undefined {
  if (tool.readTarget) {
    return formatThreadRunReadTargetLabel(tool.readTarget);
  }
  if (tool.grepTarget) {
    return formatThreadRunGrepTargetLabel(tool.grepTarget);
  }
  return tool.detail?.trim() || undefined;
}

export function resolveReadToolTargetDisplay(
  target: SdkReadToolTarget | undefined,
): ReadToolTargetDisplay | undefined {
  if (!target?.filePath.trim()) {
    return undefined;
  }
  const filePath = target.filePath.trim();
  const fileName = pathBasename(filePath);
  const lineRange = formatReadLineRange(target.offset, target.limit);
  return {
    fileName,
    filePath,
    ...(target.offset !== undefined && { offset: target.offset }),
    ...(target.limit !== undefined && { limit: target.limit }),
    ...(lineRange && { lineRange }),
  };
}

export function resolveGrepToolTargetDisplay(
  target: SdkGrepToolTarget | undefined,
): GrepToolTargetDisplay | undefined {
  if (!target?.pattern.trim()) {
    return undefined;
  }
  const pattern = target.pattern.trim();
  const path = target.path?.trim();
  const glob = target.glob?.trim();
  const scopeLabel = path ? pathBasename(path) : glob ? `glob:${glob}` : undefined;
  return {
    pattern,
    ...(path && { path }),
    ...(glob && { glob }),
    ...(scopeLabel && { scopeLabel }),
  };
}

export function formatThreadRunReadTargetLabel(target: SdkReadToolTarget): string {
  return formatReadTargetLabel(target);
}

export function formatThreadRunGrepTargetLabel(target: SdkGrepToolTarget): string {
  return formatGrepTargetLabel(target);
}

export function resolveThreadRunToolTargets(
  toolName: string,
  input: unknown,
): { readTarget?: SdkReadToolTarget; grepTarget?: SdkGrepToolTarget } {
  const readTarget = resolveReadTargetFromToolInput(toolName, input);
  const grepTarget = readTarget ? undefined : resolveGrepTargetFromToolInput(toolName, input);
  return {
    ...(readTarget && { readTarget }),
    ...(grepTarget && { grepTarget }),
  };
}

export function parseThreadRunReadToolTarget(value: unknown): SdkReadToolTarget | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const filePath = readString(value.filePath) ?? readString(value.file_path);
  if (!filePath) {
    return undefined;
  }
  const offset = readPositiveInt(value.offset);
  const limit = readPositiveInt(value.limit);
  return {
    filePath,
    ...(offset !== undefined && { offset }),
    ...(limit !== undefined && { limit }),
  };
}

export function parseThreadRunGrepToolTarget(value: unknown): SdkGrepToolTarget | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const pattern = readString(value.pattern);
  if (!pattern) {
    return undefined;
  }
  const path = readString(value.path);
  const glob = readString(value.glob);
  const outputMode = readString(value.outputMode) ?? readString(value.output_mode);
  const contextBefore = readNonNegativeInt(value.contextBefore) ?? readNonNegativeInt(value.context_before);
  const contextAfter = readNonNegativeInt(value.contextAfter) ?? readNonNegativeInt(value.context_after);
  const contextAround = readNonNegativeInt(value.contextAround) ?? readNonNegativeInt(value.context_around);
  const headLimit = readPositiveInt(value.headLimit) ?? readPositiveInt(value.head_limit);
  const type = readString(value.type);
  const multiline = typeof value.multiline === "boolean" ? value.multiline : undefined;
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

function pathBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
}
