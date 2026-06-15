import type { AnthropicProxyRoute } from "./anthropic-proxy";
import { buildProviderRequestBaseUrl } from "./provider-models";
import type { CommitDiffContext } from "./git-operations";

const ANTHROPIC_VERSION = "2023-06-01";
const COMMIT_MESSAGE_TIMEOUT_MS = 30_000;
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

export async function summarizeCommitMessage(
  route: AnthropicProxyRoute,
  context: CommitDiffContext,
  fetcher: Fetcher = fetch,
): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COMMIT_MESSAGE_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": ANTHROPIC_VERSION,
    };
    const apiKey = route.provider.apiKey.trim();
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }
    const response = await fetcher(
      `${buildProviderRequestBaseUrl(route.provider.baseUrl, route.provider.requestPath)}/v1/messages`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: route.modelId,
          max_tokens: 256,
          temperature: 0,
          system: [
            "你是 Git 提交信息生成器。",
            "根据 diff 概括变更意图，遵循 Conventional Commits。",
            "第一行是简短 subject；如需 body，用空行分隔后用 - 开头的 bullet。",
            "不要输出拒绝、道歉或能力限制类语句。",
          ].join(" "),
          messages: [
            {
              role: "user",
              content: buildCommitMessageUserMessage(context),
            },
          ],
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as unknown;
    return sanitizeCommitMessage(extractCommitMessageText(body));
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

function extractCommitMessageText(body: unknown): string | undefined {
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
