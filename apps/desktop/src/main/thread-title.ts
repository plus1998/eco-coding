import type { AgentRole } from "../shared/ipc";
import type { AnthropicProxyRoute } from "./anthropic-proxy";
import { buildProviderRequestBaseUrl } from "./provider-models";

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_STRUCTURED_OUTPUTS_BETA = "structured-outputs-2025-11-13";
const TITLE_TIMEOUT_MS = 15_000;
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
  "使用与用户消息相同的语言。",
  "不要解释、不要引号包裹 JSON、不要 markdown、不要照抄用户原文。",
  "不要输出拒绝、道歉或能力限制类语句。",
].join(" ");

type Fetcher = typeof fetch;

/** Reject model refusals / internal capability messages (Codex #11396 class of bugs). */
const TITLE_REFUSAL_PATTERN =
  /(?:对不起|抱歉|无法|不能|只能生成|I\s*(?:can't|cannot)|I\s*am\s*unable|unable\s+to)/i;

/** Reject structured-artifact garbage sometimes appended to titles (Codex #17627). */
const TITLE_GARBAGE_SUFFIX_PATTERN = /[\]})'"]{3,}$/;

export function buildThreadTitleUserMessage(prompt: string): string {
  return [
    "请为下面的编码任务或问题生成一个简短的概括性标题。",
    "中文不超过 18 个字，英文 3-7 个词。",
    "只返回 JSON：{\"title\":\"...\"}。",
    "",
    prompt.trim(),
  ].join("\n");
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

  return cleaned.length > 42 ? `${cleaned.slice(0, 39)}...` : cleaned;
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

  const body: Record<string, unknown> = {
    model: titleRoute.modelId,
    max_tokens: 64,
    temperature: 0,
    system: THREAD_TITLE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildThreadTitleUserMessage(prompt),
      },
    ],
  };
  if (useStructuredOutput) {
    body.output_format = {
      type: "json_schema",
      schema: THREAD_TITLE_JSON_SCHEMA,
    };
  }

  const response = await fetcher(
    `${buildProviderRequestBaseUrl(titleRoute.provider.baseUrl, titleRoute.provider.requestPath)}/v1/messages`,
    {
      method: "POST",
      headers: titleHeaders,
      body: JSON.stringify(body),
      signal,
    },
  );

  if (!response.ok) {
    return undefined;
  }

  const responseBody = (await response.json()) as unknown;
  const rawTitle = parseThreadTitleJson(extractTitleText(responseBody));
  return sanitizeThreadTitle(rawTitle, prompt);
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
