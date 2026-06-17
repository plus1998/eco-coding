import { applyThinkingToMessagesBody } from "@eco/runtime";
import type { AnthropicProxyRoute } from "./anthropic-proxy";
import { buildProviderRequestBaseUrl } from "./provider-models";
import type { CommitDiffContext } from "./git-operations";
import { ROUTE_TEST_THINKING_EFFORT } from "../shared/models";
import {
  headersToLoggable,
  logUpstream,
  logUpstreamError,
  truncateForLog,
} from "./upstream-log";

const ANTHROPIC_VERSION = "2023-06-01";
const COMMIT_MESSAGE_TIMEOUT_MS = 30_000;
const COMMIT_MESSAGE_MAX_TOKENS = 512;
const COMMIT_MESSAGE_MAX_CHARS = 2_000;

const COMMIT_REFUSAL_PATTERN =
  /(?:对不起|抱歉|无法|不能|I\s*(?:can't|cannot)|I\s*am\s*unable|unable\s+to)/i;

type Fetcher = typeof fetch;

export function buildCommitMessageUserMessage(context: CommitDiffContext): string {
  const parts = [
    "请根据以下 Git 变更生成一条提交信息。",
    "使用 Conventional Commits 风格：type(scope): subject，必要时附 2-4 条简短 bullet body。",
    "只输出最终 commit message 正文，不要引号、不要 markdown 代码块、不要解释。",
    "",
    "## Staged files",
    context.stagedNameStatus || "(empty)",
    "",
    "## Staged stat",
    context.stagedStat || "(empty)",
    "",
    "## Staged patch",
    context.stagedPatch || "(empty)",
  ];
  if (context.stagedPatchTruncated) {
    parts.push("", "（staged patch 已在上方截断）");
  }
  if (context.unstagedNameStatus) {
    parts.push("", "## Unstaged files", context.unstagedNameStatus);
  }
  if (context.unstagedPatch) {
    parts.push("", "## Unstaged patch", context.unstagedPatch);
    if (context.unstagedPatchTruncated) {
      parts.push("", "（unstaged patch 已在上方截断）");
    }
  }
  if (context.recentCommits) {
    parts.push("", "## Recent commits (style reference)", context.recentCommits);
  }
  return parts.join("\n");
}

export function buildCommitMessageRequestBody(
  route: AnthropicProxyRoute,
  context: CommitDiffContext,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: route.modelId,
    max_tokens: COMMIT_MESSAGE_MAX_TOKENS,
    temperature: 0,
    system: [
      "你是 Git 提交信息生成器。",
      "根据 diff 概括变更意图，遵循 Conventional Commits。",
      "第一行是简短 subject；如需 body，用空行分隔后用 - 开头的 bullet。",
      "不要输出拒绝、道歉或能力限制类语句。",
      "不要输出思考过程，只输出 commit message 正文。",
    ].join(" "),
    messages: [
      {
        role: "user",
        content: buildCommitMessageUserMessage(context),
      },
    ],
  };
  // Commit messages are short; disable thinking so token budget goes to the final text.
  applyThinkingToMessagesBody(body, ROUTE_TEST_THINKING_EFFORT);
  return body;
}

export async function summarizeCommitMessage(
  route: AnthropicProxyRoute,
  context: CommitDiffContext,
  fetcher: Fetcher = fetch,
): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COMMIT_MESSAGE_TIMEOUT_MS);
  const requestUrl = `${buildProviderRequestBaseUrl(route.provider.baseUrl, route.provider.requestPath)}/v1/messages`;
  const requestBody = buildCommitMessageRequestBody(route, context);
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": ANTHROPIC_VERSION,
    };
    const apiKey = route.provider.apiKey.trim();
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }
    logUpstream("git-commit-message-request", {
      role: route.role,
      provider: route.provider.name,
      modelId: route.modelId,
      url: requestUrl,
      headers: headersToLoggable(headers),
      body: requestBody,
    });
    const response = await fetcher(requestUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (!response.ok) {
      logUpstreamError("git-commit-message-response-error", {
        role: route.role,
        provider: route.provider.name,
        modelId: route.modelId,
        status: response.status,
        statusText: response.statusText,
        body: truncateForLog(responseText),
      });
      return undefined;
    }
    let body: unknown;
    try {
      body = JSON.parse(responseText) as unknown;
    } catch (error) {
      logUpstreamError("git-commit-message-parse-error", {
        role: route.role,
        provider: route.provider.name,
        modelId: route.modelId,
        status: response.status,
        body: truncateForLog(responseText),
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
    const extracted = extractCommitMessageText(body);
    const sanitized = sanitizeCommitMessage(extracted);
    logUpstream("git-commit-message-response", {
      role: route.role,
      provider: route.provider.name,
      modelId: route.modelId,
      status: response.status,
      body: body,
      extractedText: extracted,
      sanitizedMessage: sanitized,
    });
    if (!sanitized?.trim()) {
      logUpstreamError("git-commit-message-invalid", {
        role: route.role,
        provider: route.provider.name,
        modelId: route.modelId,
        reason: !extracted?.trim()
          ? "empty-extracted-text"
          : COMMIT_REFUSAL_PATTERN.test((extracted ?? "").split("\n")[0] ?? "")
            ? "refusal-pattern"
            : "empty-after-sanitize",
        extractedText: extracted,
      });
    }
    return sanitized;
  } catch (error) {
    logUpstreamError("git-commit-message-fetch-error", {
      role: route.role,
      provider: route.provider.name,
      modelId: route.modelId,
      url: requestUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export function sanitizeCommitMessage(message: string | undefined): string | undefined {
  const normalized = (message ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, "")
    .trim();
  if (!normalized) {
    return undefined;
  }
  if (COMMIT_REFUSAL_PATTERN.test(normalized.split("\n")[0] ?? "")) {
    return undefined;
  }
  if (normalized.length > COMMIT_MESSAGE_MAX_CHARS) {
    return `${normalized.slice(0, COMMIT_MESSAGE_MAX_CHARS - 1)}…`;
  }
  return normalized;
}

export function extractCommitMessageText(body: unknown): string | undefined {
  if (!isRecord(body) || !Array.isArray(body.content)) {
    return undefined;
  }
  const chunks: string[] = [];
  for (const block of body.content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
      chunks.push(block.text);
    }
  }
  return chunks.join("\n").trim() || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
