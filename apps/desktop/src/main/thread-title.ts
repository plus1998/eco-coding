import type { AnthropicProxyRoute } from "./anthropic-proxy";

const ANTHROPIC_VERSION = "2023-06-01";
const TITLE_TIMEOUT_MS = 15_000;
export const pendingThreadTitle = "新编码任务";

type Fetcher = typeof fetch;

export async function summarizeThreadTitleWithCoder(
  routes: readonly AnthropicProxyRoute[],
  prompt: string,
  fetcher: Fetcher = fetch,
): Promise<string | undefined> {
  const coderRoute = routes.find((route) => route.role === "coder");
  if (!coderRoute) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS);
  try {
    const response = await fetcher(`${trimTrailingSlash(coderRoute.provider.baseUrl)}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
        "x-api-key": coderRoute.provider.apiKey,
      },
      body: JSON.stringify({
        model: coderRoute.modelId,
        max_tokens: 48,
        temperature: 0,
        system:
          "你是编码任务标题生成器。用 coder 视角总结用户任务，输出一个简短标题。只输出标题，不要解释，不要照抄用户原文。",
        messages: [
          {
            role: "user",
            content: `请为下面的编码任务生成标题，中文不超过 18 个字，英文不超过 6 个词：\n\n${prompt.trim()}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return undefined;
    }

    const body = (await response.json()) as unknown;
    return sanitizeThreadTitle(extractTitleText(body), prompt);
  } finally {
    clearTimeout(timeout);
  }
}

export function sanitizeThreadTitle(title: string | undefined, prompt: string): string | undefined {
  const cleaned = (title ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^标题\s*[:：]\s*/i, "")
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return undefined;
  }

  if (normalizeTitle(cleaned) === normalizeTitle(prompt)) {
    return undefined;
  }

  return cleaned.length > 42 ? `${cleaned.slice(0, 39)}...` : cleaned;
}

function extractTitleText(body: unknown): string | undefined {
  if (!isRecord(body) || !Array.isArray(body.content)) {
    return undefined;
  }

  for (const block of body.content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
      return block.text;
    }
  }
  return undefined;
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
