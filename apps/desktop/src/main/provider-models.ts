import type {
  ListUpstreamModelsRequest,
  ListUpstreamModelsResult,
  RoleRouteTestResult,
  TestProviderConnectionRequest,
  TestProviderConnectionResult,
  TestRoleRouteItem,
  TestRoleRoutesRequest,
  TestRoleRoutesResult,
  UpstreamModelOption,
} from "../shared/models";
import { applyThinkingToMessagesBody } from "@eco/runtime";
import type { ThinkingEffort } from "../shared/ipc";
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

  return fetchUpstreamModelsFromCredentials(resolved.baseUrl, resolved.apiKey, resolved.requestPath);
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

  const testResult = await postMessagesTest(
    {
      providerId: request.providerId,
      baseUrl: resolved.baseUrl,
      requestPath: resolved.requestPath,
      apiKey: resolved.apiKey,
      modelId,
    },
    undefined,
    fetcher,
  );
  if (testResult.ok) {
    return { ok: true, reply: testResult.reply };
  }
  return { ok: false, error: testResult.error };
}

/** Dedupe key for route tests: same provider + model only needs one /v1/messages call. */
export function buildRouteTestDedupeKey(providerId: string, modelId: string): string {
  return `${providerId.trim()}:${modelId.trim()}`;
}

interface RouteTestGroup {
  provider: NonNullable<ReturnType<ProviderStore["getProviderWithSecret"]>>;
  modelId: string;
  thinkingEffort?: ThinkingEffort;
  roles: string[];
}

export async function testRoleRoutes(
  store: ProviderStore,
  request: TestRoleRoutesRequest,
  fetcher: typeof fetch = fetch,
): Promise<TestRoleRoutesResult> {
  const resultsByRole = new Map<string, RoleRouteTestResult>();
  const groups = new Map<string, RouteTestGroup>();

  for (const route of request.routes) {
    const modelId = route.modelId?.trim();
    if (!route.providerId?.trim() || !modelId) {
      resultsByRole.set(route.role, {
        role: route.role,
        modelId: modelId ?? "",
        ok: false,
        error: "请先选择 Provider 与模型。",
      });
      continue;
    }

    const provider = store.getProviderWithSecret(route.providerId.trim());
    if (!provider) {
      resultsByRole.set(route.role, {
        role: route.role,
        modelId,
        ok: false,
        error: `找不到 Provider：${route.providerId}`,
      });
      continue;
    }

    if (!provider.enabled) {
      resultsByRole.set(route.role, {
        role: route.role,
        modelId,
        ok: false,
        error: `Provider「${provider.name}」已禁用。`,
      });
      continue;
    }

    const dedupeKey = buildRouteTestDedupeKey(provider.id, modelId);
    const existing = groups.get(dedupeKey);
    if (existing) {
      existing.roles.push(route.role);
      continue;
    }

    groups.set(dedupeKey, {
      provider,
      modelId,
      thinkingEffort: parseRouteThinkingEffort(route.thinkingEffort),
      roles: [route.role],
    });
  }

  for (const group of groups.values()) {
    const labelRole = group.roles[0];
    const testResult = await postMessagesTest(
      {
        providerId: group.provider.id,
        baseUrl: group.provider.baseUrl,
        requestPath: group.provider.requestPath,
        apiKey: group.provider.apiKey,
        modelId: group.modelId,
        role: labelRole,
      },
      group.thinkingEffort,
      fetcher,
    );

    const shared: RoleRouteTestResult = {
      role: labelRole ?? "",
      modelId: group.modelId,
      ok: testResult.ok,
      ...(testResult.ok
        ? { reply: testResult.reply, elapsedMs: testResult.elapsedMs }
        : { error: testResult.error, elapsedMs: testResult.elapsedMs }),
    };

    for (const role of group.roles) {
      resultsByRole.set(role, { ...shared, role });
    }
  }

  const results = request.routes.map(
    (route) =>
      resultsByRole.get(route.role) ?? {
        role: route.role,
        modelId: route.modelId?.trim() ?? "",
        ok: false,
        error: "未执行测试。",
      },
  );

  const passed = results.filter((result) => result.ok).length;
  return { results, passed, failed: results.length - passed };
}

type MessagesTestSuccess = { ok: true; reply: string; elapsedMs: number };
type MessagesTestFailure = { ok: false; error: string; elapsedMs?: number };
type MessagesTestResult = MessagesTestSuccess | MessagesTestFailure;

async function postMessagesTest(
  input: {
    providerId?: string;
    baseUrl: string;
    requestPath: string;
    apiKey: string;
    modelId: string;
    role?: string;
  },
  thinkingEffort: ThinkingEffort | undefined,
  fetcher: typeof fetch,
): Promise<MessagesTestResult> {
  const messagesUrl = buildMessagesUrl(input.baseUrl, input.requestPath);
  const requestBody = buildMessagesTestRequestBody(input.modelId, thinkingEffort);
  const requestHeaders = {
    ...buildAnthropicHeaders(input.apiKey),
    "content-type": "application/json",
  };

  logUpstream("provider-test-start", {
    providerId: input.providerId,
    role: input.role,
    baseUrl: input.baseUrl,
    url: messagesUrl,
    model: input.modelId,
    hasApiKey: Boolean(input.apiKey.trim()),
    apiKeyPreview: input.apiKey.trim() ? redactSecret(input.apiKey) : undefined,
    requestBody,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    logUpstream("provider-test-request", {
      providerId: input.providerId,
      role: input.role,
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
      providerId: input.providerId,
      role: input.role,
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
        providerId: input.providerId,
        role: input.role,
        phase: "upstream-http",
        status: response.status,
        elapsedMs,
        error,
      });
      return { ok: false, error, elapsedMs };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      logUpstream("provider-test-error", {
        providerId: input.providerId,
        role: input.role,
        phase: "parse-json",
        elapsedMs,
        error: "上游返回了非 JSON 响应。",
        bodyRaw: truncateForLog(raw),
      });
      return { ok: false, error: "上游返回了非 JSON 响应。", elapsedMs };
    }

    const reply = extractAssistantReply(parsed);
    if (!reply) {
      logUpstream("provider-test-error", {
        providerId: input.providerId,
        role: input.role,
        phase: "parse-assistant-reply",
        elapsedMs,
        error: "上游未返回可识别的 assistant 文本。",
        responseShape: describeResponseShape(parsed),
        bodyJson: parsed,
      });
      return { ok: false, error: "上游未返回可识别的 assistant 文本。", elapsedMs };
    }

    logUpstream("provider-test-success", {
      providerId: input.providerId,
      role: input.role,
      elapsedMs,
      model: input.modelId,
      replyPreview: truncateForLog(reply),
      replyLength: reply.length,
    });
    return { ok: true, reply, elapsedMs };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    if (error instanceof Error && error.name === "AbortError") {
      logUpstream("provider-test-error", {
        providerId: input.providerId,
        role: input.role,
        phase: "timeout",
        elapsedMs,
        timeoutMs: PROVIDER_TEST_TIMEOUT_MS,
        error: "请求超时，请检查 baseURL 与网络。",
      });
      return { ok: false, error: "请求超时，请检查 baseURL 与网络。", elapsedMs };
    }
    const message = error instanceof Error ? error.message : String(error);
    logUpstream("provider-test-error", {
      providerId: input.providerId,
      role: input.role,
      phase: "fetch",
      elapsedMs,
      error: message,
      errorName: error instanceof Error ? error.name : undefined,
    });
    return { ok: false, error: message, elapsedMs };
  } finally {
    clearTimeout(timeout);
  }
}

/** Normalize request path prefix (e.g. `/anthropic`). Empty string means API root. */
export function normalizeRequestPath(path?: string): string {
  const trimmed = path?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

/** Base URL for upstream Anthropic-compatible requests (`baseUrl` + optional `requestPath`). */
export function buildProviderRequestBaseUrl(baseUrl: string, requestPath?: string): string {
  const path = normalizeRequestPath(requestPath);
  if (path) {
    return `${trimTrailingSlash(baseUrl.trim())}${path}`;
  }
  const split = splitBaseUrlAndRequestPath(baseUrl);
  if (split.requestPath) {
    return `${split.baseUrl}${split.requestPath}`;
  }
  return trimTrailingSlash(baseUrl.trim());
}

/** Anthropic Messages API: POST `{requestBase}/v1/messages`. */
export function buildMessagesUrl(baseUrl: string, requestPath?: string): string {
  return `${buildProviderRequestBaseUrl(baseUrl, requestPath)}/v1/messages`;
}

/** Split legacy baseURL that embedded a path suffix into origin + request path. */
export function splitBaseUrlAndRequestPath(fullUrl: string): { baseUrl: string; requestPath: string } {
  const trimmed = fullUrl.trim();
  if (!trimmed) {
    return { baseUrl: "", requestPath: "" };
  }
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    const pathname = parsed.pathname.replace(/\/+$/, "") || "";
    if (!pathname || pathname === "/") {
      return { baseUrl: parsed.origin, requestPath: "" };
    }
    return { baseUrl: parsed.origin, requestPath: pathname };
  } catch {
    return { baseUrl: trimmed, requestPath: "" };
  }
}

/** Path prefixes used only for Anthropic Messages, not for `/v1/models` discovery. */
const MESSAGES_ONLY_REQUEST_PATHS = new Set(["/anthropic"]);

function isMessagesOnlyRequestPath(path: string): boolean {
  return MESSAGES_ONLY_REQUEST_PATHS.has(normalizeRequestPath(path));
}

/**
 * OpenAI-style model discovery: GET `{serviceRoot}/v1/models`.
 * Includes `requestPath` when it is part of the API root (e.g. OpenCode `/zen`),
 * but not when it is messages-only (e.g. DeepSeek `/anthropic`).
 */
export function buildModelsListUrl(baseUrl: string, requestPath?: string): string {
  const path = normalizeRequestPath(requestPath);
  let root: string;

  if (path) {
    root = isMessagesOnlyRequestPath(path)
      ? trimTrailingSlash(baseUrl.trim())
      : buildProviderRequestBaseUrl(baseUrl, path);
  } else {
    const split = splitBaseUrlAndRequestPath(baseUrl);
    if (split.requestPath && isMessagesOnlyRequestPath(split.requestPath)) {
      root = split.baseUrl;
    } else {
      root = buildProviderRequestBaseUrl(baseUrl);
    }
  }

  if (!root) {
    return "/v1/models";
  }
  return `${root}/v1/models`;
}

export async function fetchUpstreamModelsFromCredentials(
  baseUrl: string,
  apiKey: string,
  requestPath?: string,
): Promise<ListUpstreamModelsResult> {
  const modelsUrl = buildModelsListUrl(baseUrl, requestPath);

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
  return buildMessagesTestRequestBody(modelId, "off");
}

export function buildMessagesTestRequestBody(
  modelId: string,
  thinkingEffort?: ThinkingEffort,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: PROVIDER_TEST_MAX_TOKENS,
    messages: [{ role: "user", content: "hi" }],
  };
  applyThinkingToMessagesBody(body, thinkingEffort ?? "off");
  return body;
}

const ROUTE_THINKING_EFFORTS = new Set<ThinkingEffort>(["off", "low", "medium", "high", "xhigh", "max"]);

function parseRouteThinkingEffort(value: string | undefined): ThinkingEffort | undefined {
  if (!value) {
    return undefined;
  }
  return ROUTE_THINKING_EFFORTS.has(value as ThinkingEffort) ? (value as ThinkingEffort) : undefined;
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
  request: ListUpstreamModelsRequest | TestProviderConnectionRequest,
):
  | { ok: true; baseUrl: string; requestPath: string; apiKey: string }
  | { ok: false; error: string } {
  const baseUrl = request.baseUrl?.trim();
  const inlineApiKey = request.apiKey?.trim();
  const inlineRequestPath =
    "requestPath" in request ? normalizeRequestPath(request.requestPath) : "";

  if (request.providerId) {
    const provider = store.getProviderWithSecret(request.providerId);
    if (!provider) {
      return { ok: false, error: `找不到 Provider：${request.providerId}` };
    }
    const resolvedBaseUrl = baseUrl || provider.baseUrl;
    const resolvedRequestPath =
      "requestPath" in request && request.requestPath !== undefined
        ? inlineRequestPath
        : provider.requestPath;
    const resolvedApiKey = inlineApiKey ?? provider.apiKey ?? "";
    return {
      ok: true,
      baseUrl: resolvedBaseUrl,
      requestPath: resolvedRequestPath,
      apiKey: resolvedApiKey,
    };
  }

  if (!baseUrl) {
    return { ok: false, error: "请先填写 baseURL。" };
  }

  return { ok: true, baseUrl, requestPath: inlineRequestPath, apiKey: inlineApiKey ?? "" };
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
