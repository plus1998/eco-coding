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
  const projected = {
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
    ...(tool.nonExecutionKind === "denied" ||
    tool.nonExecutionKind === "interrupted" ||
    tool.nonExecutionKind === "cancelled"
      ? { nonExecutionKind: tool.nonExecutionKind }
      : {}),
    ...(tool.description?.trim() && { description: tool.description.trim() }),
    ...(tool.fileChange && { fileChange: tool.fileChange }),
    ...(tool.readTarget && { readTarget: tool.readTarget }),
    ...(tool.grepTarget && { grepTarget: tool.grepTarget }),
    ...(tool.webSearch && { webSearch: projectWebSearchMetadata(tool.webSearch) }),
    ...(tool.imageView?.path.trim() && { imageView: { path: tool.imageView.path.trim() } }),
    ...(tool.imageDisplay?.artifactId.trim() && {
      imageDisplay: {
        artifactId: tool.imageDisplay.artifactId.trim(),
        ...(tool.imageDisplay.title?.trim() ? { title: tool.imageDisplay.title.trim() } : {}),
      },
    }),
    ...(tool.htmlHost?.pageId.trim() &&
      tool.htmlHost.publicUrl.trim() && {
        htmlHost: {
          pageId: tool.htmlHost.pageId.trim(),
          publicUrl: tool.htmlHost.publicUrl.trim(),
          ...(tool.htmlHost.title?.trim() ? { title: tool.htmlHost.title.trim() } : {}),
          ...(tool.htmlHost.expiresAt?.trim() ? { expiresAt: tool.htmlHost.expiresAt.trim() } : {}),
          ...(typeof tool.htmlHost.canExtend === "boolean" ? { canExtend: tool.htmlHost.canExtend } : {}),
        },
      }),
    ...(tool.mcpDiscovery?.kind === "search" && { mcpDiscovery: { kind: "search" as const } }),
    ...(tool.sendMessage && { sendMessage: tool.sendMessage }),
  };
  return projected;
}

function projectWebSearchMetadata(
  value: NonNullable<ThreadRunToolMetadata["webSearch"]>,
): NonNullable<ThreadRunToolMetadata["webSearch"]> {
  const query = value.query?.trim();
  const url = value.url?.trim();
  const pattern = value.pattern?.trim();
  const provider = value.provider?.trim();
  const queries = Array.isArray(value.queries)
    ? value.queries
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim())
        .slice(0, 12)
    : undefined;
  const results = Array.isArray(value.results)
    ? value.results
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return undefined;
          }
          const title = typeof entry.title === "string" ? entry.title.trim() : "";
          const hitUrl = typeof entry.url === "string" ? entry.url.trim() : "";
          const description =
            typeof entry.description === "string" ? entry.description.trim() : undefined;
          if (!title && !hitUrl && !description) {
            return undefined;
          }
          return {
            title,
            url: hitUrl,
            ...(description ? { description } : {}),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .slice(0, 12)
    : undefined;
  const actionType = value.actionType;
  const mode = value.mode === "fetch" || value.mode === "search" ? value.mode : undefined;
  return {
    ...(query && { query }),
    ...(url && { url }),
    ...(pattern && { pattern }),
    ...(provider && { provider }),
    ...(queries && queries.length > 0 && { queries }),
    ...(results && results.length > 0 && { results }),
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
