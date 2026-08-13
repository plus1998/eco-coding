import { createToolOutputPreview } from "@eco/runtime";
import type { ThreadRunToolMetadata } from "./thread-run-events";

export function projectThreadRunToolMetadata(
  tool: ThreadRunToolMetadata | undefined,
): ThreadRunToolMetadata | undefined {
  if (!tool) {
    return undefined;
  }
  const name = tool.name.trim();
  if (!name) {
    return undefined;
  }
  const outputPreview =
    name === "Bash" && tool.outputPreview?.trim() ? createToolOutputPreview(tool.outputPreview) : undefined;
  return {
    name,
    ...(tool.detail?.trim() && { detail: tool.detail.trim() }),
    ...(outputPreview?.text && { outputPreview: outputPreview.text }),
    ...(outputPreview?.text &&
      (tool.outputPreviewTruncated || outputPreview.truncated) && {
        outputPreviewTruncated: true,
      }),
    ...(tool.toolUseId?.trim() && { toolUseId: tool.toolUseId.trim() }),
    ...(tool.durationMs !== undefined && Number.isFinite(tool.durationMs) && { durationMs: tool.durationMs }),
    ...(tool.exitCode !== undefined && Number.isFinite(tool.exitCode) && { exitCode: tool.exitCode }),
    ...(isThreadRunToolStatus(tool.status) && { status: tool.status }),
    ...(tool.description?.trim() && { description: tool.description.trim() }),
    ...(tool.fileChange && { fileChange: tool.fileChange }),
    ...(tool.readTarget && { readTarget: tool.readTarget }),
    ...(tool.grepTarget && { grepTarget: tool.grepTarget }),
    ...(tool.webSearch && { webSearch: projectWebSearchMetadata(tool.webSearch) }),
    ...(tool.sendMessage && { sendMessage: tool.sendMessage }),
  };
}

function projectWebSearchMetadata(
  value: NonNullable<ThreadRunToolMetadata["webSearch"]>,
): NonNullable<ThreadRunToolMetadata["webSearch"]> {
  const query = value.query?.trim();
  const url = value.url?.trim();
  const pattern = value.pattern?.trim();
  const queries = Array.isArray(value.queries)
    ? value.queries
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim())
        .slice(0, 12)
    : undefined;
  const actionType = value.actionType;
  const mode = value.mode === "fetch" || value.mode === "search" ? value.mode : undefined;
  return {
    ...(query && { query }),
    ...(url && { url }),
    ...(pattern && { pattern }),
    ...(queries && queries.length > 0 && { queries }),
    ...(actionType === "search" ||
    actionType === "openPage" ||
    actionType === "findInPage" ||
    actionType === "other"
      ? { actionType }
      : {}),
    ...(mode && { mode }),
  };
}

export function projectThreadRunToolMetadataForFeed(
  tool: ThreadRunToolMetadata | undefined,
): ThreadRunToolMetadata | undefined {
  const projected = projectThreadRunToolMetadata(tool);
  if (!projected) {
    return undefined;
  }
  const { outputPreview: _outputPreview, outputPreviewTruncated: _truncated, ...feedTool } = projected;
  return feedTool;
}

function isThreadRunToolStatus(value: unknown): value is NonNullable<ThreadRunToolMetadata["status"]> {
  return value === "started" || value === "completed" || value === "failed";
}
