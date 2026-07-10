import { type AnthropicRequest, responsesInputTokensToAnthropicCount } from "@eco/openai-anthropic-bridge";
import type { UpstreamApiCompat } from "../shared/api-compat";
import type { ProviderTokenCountMode } from "../shared/provider-token-count";
import { estimateAnthropicRequestTokens } from "../shared/token-estimate";
import { buildBridgeUpstreamMessagesPayload, stripSemanticCompactionDirectives } from "./bridge-upstream";
import {
  buildMessagesUrl,
  buildProviderRequestBaseUrl,
  buildResponsesInputTokensUrl,
  resolveRequestPathForApiCompat,
} from "./provider-models";
import type { ProviderConfigSecret } from "./provider-store";
import { buildProviderDirectUpstreamHeaders } from "./upstream-request-headers";

const DEFAULT_TOKEN_COUNT_TIMEOUT_MS = 30_000;

export type ProviderTokenCountPrecision = "provider_exact" | "tokenizer_exact" | "heuristic";

export interface ProviderTokenCountResult {
  tokens: number;
  precision: ProviderTokenCountPrecision;
  source: string;
}

export interface CountProviderInputTokensRequest {
  mode: ProviderTokenCountMode;
  provider: ProviderConfigSecret;
  modelId: string;
  anthropicBody: Record<string, unknown>;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  upstreamUserAgent?: string;
  timeoutMs?: number;
}

export async function countProviderInputTokens(
  input: CountProviderInputTokensRequest,
): Promise<ProviderTokenCountResult> {
  if (input.mode === "local_heuristic") {
    return {
      tokens: estimateAnthropicRequestTokens(input.anthropicBody),
      precision: "heuristic",
      source: "eco:local_heuristic",
    };
  }

  const request = normalizeAnthropicCountRequest(input.anthropicBody, input.modelId);
  switch (input.mode) {
    case "anthropic_messages":
      return countViaAnthropicMessages(input, request);
    case "openai_responses":
      return countViaOpenAIResponses(input, request);
    case "llama_tokenize":
      return countViaLlamaTokenizer(input, request);
    default:
      throw new Error(`无效的 Provider token 计数模式：${String(input.mode)}`);
  }
}

async function countViaAnthropicMessages(
  input: CountProviderInputTokensRequest,
  request: AnthropicRequest,
): Promise<ProviderTokenCountResult> {
  const url = `${buildMessagesUrl(input.provider.baseUrl, input.provider.requestPath)}/count_tokens`;
  const raw = await postJsonForTokenCount(
    input,
    url,
    request as unknown as Record<string, unknown>,
    "anthropic",
  );
  return {
    tokens: parseInputTokens(raw, "Anthropic count_tokens"),
    precision: "provider_exact",
    source: url,
  };
}

async function countViaOpenAIResponses(
  input: CountProviderInputTokensRequest,
  request: AnthropicRequest,
): Promise<ProviderTokenCountResult> {
  const url = buildResponsesInputTokensUrl(input.provider.baseUrl, input.provider.requestPath);
  const upstreamBody = buildBridgeUpstreamMessagesPayload("openai_responses", request, input.modelId, false);
  const body = pickResponsesInputTokenFields(upstreamBody);
  const raw = await postJsonForTokenCount(input, url, body, "openai_responses");
  return {
    tokens: responsesInputTokensToAnthropicCount(raw).input_tokens,
    precision: "provider_exact",
    source: url,
  };
}

async function countViaLlamaTokenizer(
  input: CountProviderInputTokensRequest,
  request: AnthropicRequest,
): Promise<ProviderTokenCountResult> {
  const chatBody = buildBridgeUpstreamMessagesPayload(
    "openai_chat_completions",
    request,
    input.modelId,
    false,
  );
  if (Array.isArray(chatBody.tools) && chatBody.tools.length > 0) {
    throw new Error(
      "llama_tokenize 无法从 /apply-template 文档化接口精确计入 tools；请改用 llama.cpp 的 anthropic_messages 或 openai_responses 计数模式。",
    );
  }
  if (!Array.isArray(chatBody.messages)) {
    throw new Error("llama_tokenize 转换后缺少 chat messages。");
  }

  const requestPath = resolveRequestPathForApiCompat(input.provider.requestPath, "openai_chat_completions");
  const root = buildProviderRequestBaseUrl(input.provider.baseUrl, requestPath);
  const templateRaw = await postJsonForTokenCount(
    input,
    `${root}/apply-template`,
    { messages: chatBody.messages },
    "openai_chat_completions",
  );
  const prompt = readPrompt(templateRaw);
  const tokenizedRaw = await postJsonForTokenCount(
    input,
    `${root}/tokenize`,
    { content: prompt, add_special: false, parse_special: true, with_pieces: false },
    "openai_chat_completions",
  );
  const tokens = readTokenArray(tokenizedRaw);
  return {
    tokens: tokens.length,
    precision: "tokenizer_exact",
    source: `${root}/apply-template -> ${root}/tokenize`,
  };
}

function normalizeAnthropicCountRequest(body: Record<string, unknown>, modelId: string): AnthropicRequest {
  const cloned = structuredClone(body) as unknown as AnthropicRequest;
  cloned.model = modelId;
  delete (cloned as unknown as Record<string, unknown>).stream;
  return stripSemanticCompactionDirectives(cloned);
}

function pickResponsesInputTokenFields(body: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of ["model", "input", "instructions", "tools", "tool_choice", "reasoning"] as const) {
    if (body[key] !== undefined) {
      result[key] = body[key];
    }
  }
  return result;
}

async function postJsonForTokenCount(
  input: CountProviderInputTokensRequest,
  url: string,
  body: Record<string, unknown>,
  apiCompat: UpstreamApiCompat,
): Promise<unknown> {
  const fetcher = input.fetcher ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, input.timeoutMs ?? DEFAULT_TOKEN_COUNT_TIMEOUT_MS);
  const abortFromParent = () => controller.abort();
  if (input.signal?.aborted) {
    controller.abort();
  } else {
    input.signal?.addEventListener("abort", abortFromParent, { once: true });
  }
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: buildProviderDirectUpstreamHeaders({
        apiKey: input.provider.apiKey,
        apiCompat,
        ...(input.upstreamUserAgent && { upstreamUserAgent: input.upstreamUserAgent }),
      }),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `token count 上游请求失败：HTTP ${response.status}${text.trim() ? `；${text.trim()}` : ""}`,
      );
    }
    if (!text.trim()) {
      throw new Error("token count 上游返回空响应。");
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`token count 上游返回无效 JSON：${detail}`);
    }
  } catch (error) {
    if (timedOut) {
      throw new Error(`token count 上游请求超时（${input.timeoutMs ?? DEFAULT_TOKEN_COUNT_TIMEOUT_MS}ms）。`);
    }
    if (input.signal?.aborted) {
      throw new Error("token count 请求已取消。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abortFromParent);
  }
}

function parseInputTokens(raw: unknown, label: string): number {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${label} 响应不是对象。`);
  }
  const value = (raw as Record<string, unknown>).input_tokens;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} 响应缺少有效 input_tokens。`);
  }
  return Math.trunc(value);
}

function readPrompt(raw: unknown): string {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as Record<string, unknown>).prompt !== "string"
  ) {
    throw new Error("llama.cpp /apply-template 响应缺少 prompt。");
  }
  return (raw as { prompt: string }).prompt;
}

function readTokenArray(raw: unknown): unknown[] {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as Record<string, unknown>).tokens)) {
    throw new Error("llama.cpp /tokenize 响应缺少 tokens 数组。");
  }
  return (raw as { tokens: unknown[] }).tokens;
}
