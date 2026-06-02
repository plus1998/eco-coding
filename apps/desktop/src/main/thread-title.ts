import { extractPhaseDeliverable } from "@eco/runtime";
import type { AnthropicProxyRoute } from "./anthropic-proxy";
import { buildProviderRequestBaseUrl } from "./provider-models";

const ANTHROPIC_VERSION = "2023-06-01";
const TITLE_TIMEOUT_MS = 15_000;
export const pendingThreadTitle = "新编码任务";

type Fetcher = typeof fetch;

export interface ThreadTitleContext {
  plan?: string;
  analysis?: string;
}

const TITLE_CONTEXT_MAX_CHARS = 500;

const PLAN_HEADING_WITH_TITLE =
  /^#{1,3}\s*(?:实现计划|Implementation\s+Plan|Plan)\s*[：:]\s*(.+)$/im;
const PLAN_HEADING_LINE = /^#{1,3}\s*(?:实现计划|Implementation\s+Plan|Plan)\s*$/im;
const SUMMARY_SECTION = /(?:^|\n)#{1,3}\s*Summary\s*\n+([\s\S]*?)(?=\n#{1,3}\s+|\s*$)/i;

/** Derive sidebar title from planner-submitted plan markdown (no extra model call). */
export function threadTitleFromPlannerPlan(plan: string, prompt: string): string | undefined {
  const body = extractPhaseDeliverable(plan, "plan").trim() || plan.trim();
  if (!body) {
    return undefined;
  }

  const colonHeading = body.match(PLAN_HEADING_WITH_TITLE);
  if (colonHeading?.[1]?.trim()) {
    return sanitizeThreadTitle(colonHeading[1].trim(), prompt);
  }

  const summaryMatch = body.match(SUMMARY_SECTION);
  if (summaryMatch?.[1]) {
    const fromSummary = firstMeaningfulPlanLine(summaryMatch[1]);
    if (fromSummary) {
      return sanitizeThreadTitle(fromSummary, prompt);
    }
  }

  const afterPlanHeading = body.replace(PLAN_HEADING_LINE, "").trimStart();
  const candidate =
    firstMeaningfulPlanLine(afterPlanHeading !== body ? afterPlanHeading : body) ??
    firstMeaningfulPlanLine(body);
  if (candidate) {
    return sanitizeThreadTitle(candidate, prompt);
  }

  return undefined;
}

function firstMeaningfulPlanLine(section: string): string | undefined {
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      continue;
    }
    if (/^```/.test(line) || /^---+$/.test(line)) {
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet?.[1]?.trim()) {
      return bullet[1].trim();
    }
    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (numbered?.[1]?.trim()) {
      return numbered[1].trim();
    }
    return line;
  }
  return undefined;
}

export function buildThreadTitleUserMessage(prompt: string, context?: ThreadTitleContext): string {
  const parts = [`请为下面的编码任务生成标题，中文不超过 18 个字，英文不超过 6 个词：`, "", prompt.trim()];
  if (context?.analysis?.trim()) {
    parts.push("", "## 分析摘要", truncateTitleContext(context.analysis.trim()));
  }
  if (context?.plan?.trim()) {
    parts.push("", "## 实现计划摘要", truncateTitleContext(context.plan.trim()));
  }
  return parts.join("\n");
}

export async function summarizeThreadTitleWithCoder(
  routes: readonly AnthropicProxyRoute[],
  prompt: string,
  fetcher: Fetcher = fetch,
  context?: ThreadTitleContext,
): Promise<string | undefined> {
  const coderRoute = routes.find((route) => route.role === "coder");
  if (!coderRoute) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS);
  try {
    const titleHeaders: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": ANTHROPIC_VERSION,
    };
    const apiKey = coderRoute.provider.apiKey.trim();
    if (apiKey) {
      titleHeaders["x-api-key"] = apiKey;
    }
    const response = await fetcher(
      `${buildProviderRequestBaseUrl(coderRoute.provider.baseUrl, coderRoute.provider.requestPath)}/v1/messages`,
      {
        method: "POST",
        headers: titleHeaders,
        body: JSON.stringify({
          model: coderRoute.modelId,
          max_tokens: 48,
          temperature: 0,
          system:
            "你是编码任务标题生成器。用 coder 视角总结用户任务，输出一个简短标题。只输出标题，不要解释，不要照抄用户原文。",
          messages: [
            {
              role: "user",
              content: buildThreadTitleUserMessage(prompt, context),
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

function truncateTitleContext(text: string): string {
  if (text.length <= TITLE_CONTEXT_MAX_CHARS) {
    return text;
  }
  return `${text.slice(0, TITLE_CONTEXT_MAX_CHARS - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
