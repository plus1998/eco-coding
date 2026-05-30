import type { ListUpstreamModelsRequest, ListUpstreamModelsResult, UpstreamModelOption } from "../shared/models";
import type { ProviderStore } from "./provider-store";

const ANTHROPIC_VERSION = "2023-06-01";

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
