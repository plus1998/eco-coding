import type {
  ListUpstreamModelsRequest,
  ListUpstreamModelsResult,
  TestProviderConnectionRequest,
  TestProviderConnectionResult,
  UpstreamModelOption,
} from "../shared/models";
import { applyThinkingToMessagesBody } from "@eco/runtime";
import type { ProviderStore } from "./provider-store";
import {
  headersToLoggable,
  logUpstream,
  parseJsonForLog,
  redactSecret,
  truncateForLog,
} from "./upstream-log";

const ANTHROPIC_VERSION = "2023-06-01";
const PROVIDER_TEST_TIMEOUT_MS = 30_000;
const PROVIDER_TEST_MAX_TOKENS = 256;

export async function listProviderUpstreamModels(
  store: ProviderStore,
  request: ListUpstreamModelsRequest,
): Promise<ListUpstreamModelsResult> {
  const resolved = resolveProviderCredentials(store, request);
  if (!resolved.ok) {
    return resolved;
  }

  return fetchUpstreamModelsFromCredentials(resolved.baseUrl, resolved.apiKey);
}

export async function testProviderConnection(
  store: ProviderStore,
  request: TestProviderConnectionRequest,
  fetcher: typeof fetch = fetch,
): Promise<TestProviderConnectionResult> {
  const resolved = resolveProviderCredentials(store, request);
  if (!resolved.ok) {
    logUpstream("provider-test-error", {
      phase: "resolve-credentials",
      providerId: request.providerId,
      error: resolved.error,
    });
    return resolved;
  }

  const modelId = request.defaultModel?.trim();
  if (!modelId) {
    logUpstream("provider-test-error", {
      phase: "validate-model",
      providerId: request.providerId,
      baseUrl: resolved.baseUrl,
      error: "请先选择默认模型。",
    });
    return { ok: false, error: "请先选择默认模型。" };
  }

  const messagesUrl = buildMessagesUrl(resolved.baseUrl);
  const requestBody = buildProviderTestRequestBody(modelId);
  const requestHeaders = {
    ...buildAnthropicHeaders(resolved.apiKey),
    "content-type": "application/json",
  };

  logUpstream("provider-test-start", {
    providerId: request.providerId,
    baseUrl: resolved.baseUrl,
    url: messagesUrl,
    model: modelId,
    hasApiKey: Boolean(resolved.apiKey.trim()),
    apiKeyPreview: resolved.apiKey.trim() ? redactSecret(resolved.apiKey) : undefined,
    requestBody,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    logUpstream("provider-test-request", {
      providerId: request.providerId,
      method: "POST",
      url: messagesUrl,
      headers: redactRequestHeaders(requestHeaders),
      body: requestBody,
    });

    const response = await fetcher(messagesUrl, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const raw = await response.text();
    const elapsedMs = Date.now() - startedAt;
    logUpstream("provider-test-response", {
      providerId: request.providerId,
      status: response.status,
      ok: response.ok,
      elapsedMs,
      headers: headersToLoggable(response.headers),
      bodyRaw: truncateForLog(raw),
      bodyJson: parseJsonForLog(raw),
    });

    if (!response.ok) {
      const error = formatUpstreamError(response.status, raw);
      logUpstream("provider-test-error", {
        providerId: request.providerId,
        phase: "upstream-http",
        status: response.status,
        elapsedMs,
        error,
      });
      return { ok: false, error };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      logUpstream("provider-test-error", {
        providerId: request.providerId,
        phase: "parse-json",
        elapsedMs,
        error: "上游返回了非 JSON 响应。",
        bodyRaw: truncateForLog(raw),
      });
      return { ok: false, error: "上游返回了非 JSON 响应。" };
    }

    const reply = extractAssistantReply(parsed);
    if (!reply) {
      logUpstream("provider-test-error", {
        providerId: request.providerId,
        phase: "parse-assistant-reply",
        elapsedMs,
        error: "上游未返回可识别的 assistant 文本。",
        responseShape: describeResponseShape(parsed),
        bodyJson: parsed,
      });
      return { ok: false, error: "上游未返回可识别的 assistant 文本。" };
    }

    logUpstream("provider-test-success", {
      providerId: request.providerId,
      elapsedMs,
      model: modelId,
      replyPreview: truncateForLog(reply),
      replyLength: reply.length,
    });
    return { ok: true, reply };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    if (error instanceof Error && error.name === "AbortError") {
      logUpstream("provider-test-error", {
        providerId: request.providerId,
        phase: "timeout",
        elapsedMs,
        timeoutMs: PROVIDER_TEST_TIMEOUT_MS,
        error: "请求超时，请检查 baseURL 与网络。",
      });
      return { ok: false, error: "请求超时，请检查 baseURL 与网络。" };
    }
    const message = error instanceof Error ? error.message : String(error);
    logUpstream("provider-test-error", {
      providerId: request.providerId,
      phase: "fetch",
      elapsedMs,
      error: message,
      errorName: error instanceof Error ? error.name : undefined,
    });
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

/** Anthropic Messages API: POST `{baseUrl}/v1/messages` (preserves path suffix e.g. `/anthropic`). */
export function buildMessagesUrl(baseUrl: string): string {
  return `${trimTrailingSlash(baseUrl.trim())}/v1/messages`;
}

/** OpenAI-style model discovery: always GET `{origin}/v1/models`, ignoring baseUrl path (e.g. `/anthropic`). */
export function buildModelsListUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return "/v1/models";
  }
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return `${parsed.origin}/v1/models`;
  } catch {
    return `${trimTrailingSlash(trimmed).replace(/\/[^/]*$/, "")}/v1/models`;
  }
}

export async function fetchUpstreamModelsFromCredentials(
  baseUrl: string,
  apiKey: string,
): Promise<ListUpstreamModelsResult> {
  const modelsUrl = buildModelsListUrl(baseUrl);

  try {
    const response = await fetch(modelsUrl, {
      method: "GET",
      headers: buildAnthropicHeaders(apiKey),
    });

    const raw = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        error: formatUpstreamError(response.status, raw),
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, error: "上游返回了非 JSON 响应。" };
    }

    const models = parseUpstreamModelsPayload(parsed);
    if (models.length === 0) {
      return { ok: false, error: "上游未返回可用模型列表（data 为空或格式不兼容）。" };
    }

    return { ok: true, models: dedupeModels(models) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function dedupeUpstreamModels(models: readonly UpstreamModelOption[]): UpstreamModelOption[] {
  return dedupeModels([...models]);
}

export function parseUpstreamModelsPayload(payload: unknown): UpstreamModelOption[] {
  if (!isRecord(payload)) {
    return [];
  }

  const list = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
  const models: UpstreamModelOption[] = [];

  for (const item of list) {
    if (!isRecord(item)) {
      continue;
    }
    const id =
      typeof item.id === "string"
        ? item.id
        : typeof item.model === "string"
          ? item.model
          : undefined;
    if (!id?.trim()) {
      continue;
    }
    const displayName =
      typeof item.display_name === "string"
        ? item.display_name
        : typeof item.name === "string"
          ? item.name
          : undefined;
    const option: UpstreamModelOption = { id: id.trim() };
    const trimmedDisplayName = displayName?.trim();
    if (trimmedDisplayName) {
      option.displayName = trimmedDisplayName;
    }
    models.push(option);
  }

  return models;
}

function extractAssistantReply(body: unknown): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  if (Array.isArray(body.content)) {
    const textParts: string[] = [];
    const thinkingParts: string[] = [];
    for (const block of body.content) {
      if (!isRecord(block)) {
        continue;
      }
      if (block.type === "text" && typeof block.text === "string") {
        const text = block.text.trim();
        if (text) {
          textParts.push(text);
        }
      }
      if (block.type === "thinking" && typeof block.thinking === "string") {
        const text = block.thinking.trim();
        if (text) {
          thinkingParts.push(text);
        }
      }
    }
    if (textParts.length > 0) {
      return textParts.join("\n").trim();
    }
    if (thinkingParts.length > 0) {
      return thinkingParts.join("\n").trim();
    }
  }

  if (Array.isArray(body.choices)) {
    for (const choice of body.choices) {
      if (!isRecord(choice)) {
        continue;
      }
      const message = choice.message;
      if (isRecord(message) && typeof message.content === "string") {
        const text = message.content.trim();
        if (text) {
          return text;
        }
      }
      if (typeof choice.text === "string") {
        const text = choice.text.trim();
        if (text) {
          return text;
        }
      }
    }
  }

  return undefined;
}

export function buildProviderTestRequestBody(modelId: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: PROVIDER_TEST_MAX_TOKENS,
    messages: [{ role: "user", content: "hi" }],
  };
  applyThinkingToMessagesBody(body, "off");
  return body;
}

function describeResponseShape(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    return { shape: typeof body };
  }

  const content = body.content;
  return {
    topLevelKeys: Object.keys(body),
    contentKind: Array.isArray(content) ? "array" : typeof content,
    contentLength: Array.isArray(content) ? content.length : undefined,
    contentBlocks: Array.isArray(content)
      ? content.map((block) =>
          isRecord(block)
            ? {
                type: block.type,
                keys: Object.keys(block),
                textPreview:
                  typeof block.text === "string" ? truncateForLog(block.text.slice(0, 240)) : undefined,
              }
            : typeof block,
        )
      : typeof content === "string"
        ? truncateForLog(content.slice(0, 240))
        : undefined,
    choicesLength: Array.isArray(body.choices) ? body.choices.length : undefined,
    messageKeys: isRecord(body.message) ? Object.keys(body.message) : undefined,
  };
}

function redactRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "x-api-key" || lower === "authorization") {
      result[key] = redactSecret(value);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function resolveProviderCredentials(
  store: ProviderStore,
  request: ListUpstreamModelsRequest,
):
  | { ok: true; baseUrl: string; apiKey: string }
  | { ok: false; error: string } {
  const baseUrl = request.baseUrl?.trim();
  const inlineApiKey = request.apiKey?.trim();

  if (request.providerId) {
    const provider = store.getProviderWithSecret(request.providerId);
    if (!provider) {
      return { ok: false, error: `找不到 Provider：${request.providerId}` };
    }
    const resolvedBaseUrl = baseUrl || provider.baseUrl;
    const resolvedApiKey = inlineApiKey ?? provider.apiKey ?? "";
    return { ok: true, baseUrl: resolvedBaseUrl, apiKey: resolvedApiKey };
  }

  if (!baseUrl) {
    return { ok: false, error: "请先填写 baseURL。" };
  }

  return { ok: true, baseUrl, apiKey: inlineApiKey ?? "" };
}

function formatUpstreamError(status: number, raw: string): string {
  const parsed = parseJsonForLog(raw);
  if (isRecord(parsed)) {
    const message =
      (typeof parsed.error === "object" &&
        isRecord(parsed.error) &&
        typeof parsed.error.message === "string" &&
        parsed.error.message) ||
      (typeof parsed.message === "string" && parsed.message) ||
      (typeof parsed.error === "string" && parsed.error);
    if (message) {
      return `上游 ${status}：${message}`;
    }
  }
  const snippet = raw.trim().slice(0, 240);
  return snippet ? `上游 ${status}：${snippet}` : `上游请求失败（HTTP ${status}）。`;
}

function buildAnthropicHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
  };
  const trimmedKey = apiKey.trim();
  if (trimmedKey) {
    headers["x-api-key"] = trimmedKey;
    headers.authorization = `Bearer ${trimmedKey}`;
  }
  return headers;
}

function dedupeModels(models: UpstreamModelOption[]): UpstreamModelOption[] {
  const seen = new Set<string>();
  const result: UpstreamModelOption[] = [];
  for (const model of models) {
    if (seen.has(model.id)) {
      continue;
    }
    seen.add(model.id);
    result.push(model);
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseJsonForLog(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
