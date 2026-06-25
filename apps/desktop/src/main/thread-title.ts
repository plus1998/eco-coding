import type { AgentRole } from "../shared/ipc";
import type { AnthropicProxyRoute } from "./anthropic-proxy";
import { buildProviderRequestBaseUrl } from "./provider-models";
import {
  headersToLoggable,
  logUpstream,
  logUpstreamError,
  truncateForLog,
} from "./upstream-log";

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_STRUCTURED_OUTPUTS_BETA = "structured-outputs-2025-11-13";
const TITLE_TIMEOUT_MS = 90_000;
export const TITLE_PROMPT_MAX_CHARS = 8_000;
export const TITLE_OUTPUT_MAX_CHARS = 42;
export const pendingThreadTitle = "新编码任务";

/** Prefer explore for title LLM (cheap); fall back to planner then coder. */
const TITLE_ROUTE_ROLES: readonly AgentRole[] = ["explore", "planner", "coder"];

const THREAD_TITLE_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
  },
  required: ["title"],
  additionalProperties: false,
} as const;

const THREAD_TITLE_SYSTEM_PROMPT = [
  "你是会话标题生成器。根据用户任务概括意图，只输出 JSON：{\"title\":\"...\"}。",
  "中文不超过 18 个字，英文 3-7 个词，sentence case。",
  `标题总长度不超过 ${TITLE_OUTPUT_MAX_CHARS} 个字符。`,
  "使用与用户消息相同的语言。",
  "不要解释、不要引号包裹 JSON、不要 markdown、不要照抄用户原文。",
  "不要输出拒绝、道歉或能力限制类语句。",
  "不要输出思考过程，只输出 JSON。",
].join(" ");

type Fetcher = typeof fetch;

/** Reject model refusals / internal capability messages (Codex #11396 class of bugs). */
const TITLE_REFUSAL_PATTERN =
  /(?:对不起|抱歉|无法|不能|只能生成|I\s*(?:can't|cannot)|I\s*am\s*unable|unable\s+to)/i;

/** Reject structured-artifact garbage sometimes appended to titles (Codex #17627). */
const TITLE_GARBAGE_SUFFIX_PATTERN = /[\]})'"]{3,}$/;

function truncateTitlePrompt(prompt: string): { text: string; truncated: boolean } {
  const trimmed = prompt.trim();
  if (trimmed.length <= TITLE_PROMPT_MAX_CHARS) {
    return { text: trimmed, truncated: false };
  }
  return { text: trimmed.slice(0, TITLE_PROMPT_MAX_CHARS), truncated: true };
}

export function buildThreadTitleUserMessage(prompt: string): string {
  const { text, truncated } = truncateTitlePrompt(prompt);
  const parts = [
    "请为下面的编码任务或问题生成一个简短的概括性标题。",
    "中文不超过 18 个字，英文 3-7 个词。",
    `标题总长度不超过 ${TITLE_OUTPUT_MAX_CHARS} 个字符。`,
    '只返回 JSON：{"title":"..."}。',
    "",
    text,
  ];
  if (truncated) {
    parts.push("", "（任务内容已在上方截断）");
  }
  return parts.join("\n");
}

export function buildThreadTitleRequestBody(
  titleRoute: AnthropicProxyRoute,
  prompt: string,
  useStructuredOutput: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: titleRoute.modelId,
    max_tokens: 64,
    temperature: 0,
    thinking: { type: "disabled" },
    system: THREAD_TITLE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildThreadTitleUserMessage(prompt),
      },
    ],
  };
  if (titleRoute.maxOutputTokens !== undefined && titleRoute.maxOutputTokens > 0) {
    body.max_tokens = titleRoute.maxOutputTokens;
  }
  if (useStructuredOutput) {
    body.output_format = {
      type: "json_schema",
      schema: THREAD_TITLE_JSON_SCHEMA,
    };
  }
  return body;
}

export function resolveThreadTitleRoute(
  routes: readonly AnthropicProxyRoute[],
): AnthropicProxyRoute | undefined {
  for (const role of TITLE_ROUTE_ROLES) {
    const route = routes.find((entry) => entry.role === role);
    if (route) {
      return route;
    }
  }
  return undefined;
}

export function parseThreadTitleJson(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) {
    return undefined;
  }

  const candidates = [trimmed, extractJsonObjectCandidate(trimmed)].filter(
    (candidate): candidate is string => Boolean(candidate),
  );

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isRecord(parsed) && typeof parsed.title === "string") {
        const title = parsed.title.trim();
        if (title) {
          return title;
        }
      }
    } catch {
      // try next candidate
    }
  }

  return undefined;
}

export async function summarizeThreadTitle(
  routes: readonly AnthropicProxyRoute[],
  prompt: string,
  fetcher: Fetcher = fetch,
): Promise<string | undefined> {
  const titleRoute = resolveThreadTitleRoute(routes);
  if (!titleRoute) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS);
  try {
    const structured = await requestThreadTitle(titleRoute, prompt, fetcher, controller.signal, true);
    if (structured !== undefined) {
      return structured;
    }
    return requestThreadTitle(titleRoute, prompt, fetcher, controller.signal, false);
  } catch (error) {
    logUpstreamError("thread-title-fetch-error", {
      role: titleRoute.role,
      provider: titleRoute.provider.name,
      modelId: titleRoute.modelId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

/** @deprecated Use summarizeThreadTitle — titles now use the explore route when configured. */
export const summarizeThreadTitleWithCoder = summarizeThreadTitle;

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

  if (TITLE_REFUSAL_PATTERN.test(cleaned) || TITLE_GARBAGE_SUFFIX_PATTERN.test(cleaned)) {
    return undefined;
  }

  if (normalizeTitle(cleaned) === normalizeTitle(prompt)) {
    return undefined;
  }

  return cleaned.length > TITLE_OUTPUT_MAX_CHARS
    ? `${cleaned.slice(0, TITLE_OUTPUT_MAX_CHARS - 3)}...`
    : cleaned;
}

export function shouldReplaceAutoThreadTitle(currentTitle: string): boolean {
  return currentTitle === pendingThreadTitle;
}

async function requestThreadTitle(
  titleRoute: AnthropicProxyRoute,
  prompt: string,
  fetcher: Fetcher,
  signal: AbortSignal,
  useStructuredOutput: boolean,
): Promise<string | undefined> {
  const titleHeaders: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
  };
  if (useStructuredOutput) {
    titleHeaders["anthropic-beta"] = ANTHROPIC_STRUCTURED_OUTPUTS_BETA;
  }
  const apiKey = titleRoute.provider.apiKey.trim();
  if (apiKey) {
    titleHeaders["x-api-key"] = apiKey;
  }

  const requestUrl = `${buildProviderRequestBaseUrl(titleRoute.provider.baseUrl, titleRoute.provider.requestPath)}/v1/messages`;
  const body = buildThreadTitleRequestBody(titleRoute, prompt, useStructuredOutput);
  logUpstream("thread-title-request", {
    role: titleRoute.role,
    provider: titleRoute.provider.name,
    modelId: titleRoute.modelId,
    url: requestUrl,
    headers: headersToLoggable(titleHeaders),
    body,
    structuredOutput: useStructuredOutput,
  });

  const response = await fetcher(requestUrl, {
    method: "POST",
    headers: titleHeaders,
    body: JSON.stringify(body),
    signal,
  });

  const responseText = await response.text();
  if (!response.ok) {
    logUpstreamError("thread-title-response-error", {
      role: titleRoute.role,
      provider: titleRoute.provider.name,
      modelId: titleRoute.modelId,
      status: response.status,
      statusText: response.statusText,
      structuredOutput: useStructuredOutput,
      body: truncateForLog(responseText),
    });
    return undefined;
  }

  let responseBody: unknown;
  try {
    responseBody = JSON.parse(responseText) as unknown;
  } catch (error) {
    logUpstreamError("thread-title-parse-error", {
      role: titleRoute.role,
      provider: titleRoute.provider.name,
      modelId: titleRoute.modelId,
      structuredOutput: useStructuredOutput,
      body: truncateForLog(responseText),
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }

  const extracted = extractTitleText(responseBody);
  const rawTitle = parseThreadTitleJson(extracted);
  const sanitized = sanitizeThreadTitle(rawTitle, prompt);
  logUpstream("thread-title-response", {
    role: titleRoute.role,
    provider: titleRoute.provider.name,
    modelId: titleRoute.modelId,
    structuredOutput: useStructuredOutput,
    body: responseBody,
    extractedText: extracted,
    sanitizedTitle: sanitized,
  });
  if (!sanitized) {
    logUpstreamError("thread-title-invalid", {
      role: titleRoute.role,
      provider: titleRoute.provider.name,
      modelId: titleRoute.modelId,
      structuredOutput: useStructuredOutput,
      reason: !extracted?.trim()
        ? "empty-extracted-text"
        : TITLE_REFUSAL_PATTERN.test((rawTitle ?? "").split("\n")[0] ?? "")
          ? "refusal-pattern"
          : "empty-after-sanitize",
      extractedText: extracted,
      rawTitle,
    });
  }
  return sanitized;
}

export function extractTitleText(body: unknown): string | undefined {
  if (!isRecord(body) || !Array.isArray(body.content)) {
    return undefined;
  }

  const chunks: string[] = [];
  for (const block of body.content) {
    if (!isRecord(block)) {
      continue;
    }
    if (block.type === "text" && typeof block.text === "string") {
      chunks.push(block.text);
      continue;
    }
    if (block.type === "thinking" || block.type === "redacted_thinking") {
      continue;
    }
  }
  return chunks.join("\n").trim() || undefined;
}

function extractJsonObjectCandidate(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) {
    return fenced[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }

  return undefined;
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
