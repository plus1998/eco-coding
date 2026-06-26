import type { AnthropicRequest } from "@eco/openai-anthropic-bridge";
import { resolveUpstreamApiCompat, type UpstreamApiCompat } from "../shared/api-compat";
import type { AnthropicProxyRoute } from "./anthropic-proxy";
import {
  buildBridgeUpstreamMessagesPayload,
  parseBridgeProbeReply,
  resolveBridgeUpstreamUrl,
} from "./bridge-upstream";
import { buildProviderDirectUpstreamHeaders } from "./upstream-request-headers";
import {
  headersToLoggable,
  logUpstream,
  logUpstreamError,
  truncateForLog,
} from "./upstream-log";

type Fetcher = typeof fetch;

export function resolveRouteApiCompat(route: AnthropicProxyRoute): UpstreamApiCompat {
  return resolveUpstreamApiCompat(route.apiCompat, route.provider.apiCompat);
}

export interface PostAuxiliaryBridgeRequestInput {
  route: AnthropicProxyRoute;
  anthropicBody: Record<string, unknown>;
  signal?: AbortSignal;
  /** Extra headers for anthropic passthrough (e.g. structured-outputs beta). */
  anthropicExtraHeaders?: Record<string, string>;
  logEventPrefix: string;
  fetcher?: Fetcher;
  onTextDelta?: (delta: string, text: string) => void;
}

export interface PostAuxiliaryBridgeRequestResult {
  ok: boolean;
  text?: string;
  upstreamError?: string;
  status?: number;
}

export async function postAuxiliaryBridgeRequest(
  input: PostAuxiliaryBridgeRequestInput,
): Promise<PostAuxiliaryBridgeRequestResult> {
  const fetcher = input.fetcher ?? fetch;
  const apiCompat = resolveRouteApiCompat(input.route);
  const anthropicRequest = input.anthropicBody as unknown as AnthropicRequest;
  const preferStream = apiCompat !== "anthropic";
  const upstreamBody = buildBridgeUpstreamMessagesPayload(
    apiCompat,
    anthropicRequest,
    input.route.modelId,
    preferStream,
    input.route.maxOutputTokens,
  );
  const requestUrl = resolveBridgeUpstreamUrl(
    apiCompat,
    input.route.provider.baseUrl,
    input.route.provider.requestPath,
  );

  const headers = buildProviderDirectUpstreamHeaders({
    apiKey: input.route.provider.apiKey,
    apiCompat,
  });
  if (apiCompat === "anthropic" && input.anthropicExtraHeaders) {
    for (const [key, value] of Object.entries(input.anthropicExtraHeaders)) {
      if (value.trim()) {
        headers[key] = value;
      }
    }
  }

  logUpstream(`${input.logEventPrefix}-request`, {
    role: input.route.role,
    provider: input.route.provider.name,
    modelId: input.route.modelId,
    apiCompat,
    url: requestUrl,
    headers: headersToLoggable(headers),
    anthropicBody: input.anthropicBody,
    upstreamBody,
  });

  try {
    const response = await fetcher(requestUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(upstreamBody),
      ...(input.signal && { signal: input.signal }),
    });

    if (!response.ok) {
      const raw = await response.text();
      logUpstreamError(`${input.logEventPrefix}-response-error`, {
        role: input.route.role,
        provider: input.route.provider.name,
        modelId: input.route.modelId,
        apiCompat,
        status: response.status,
        statusText: response.statusText,
        body: truncateForLog(raw),
      });
      return { ok: false, status: response.status };
    }

    const parsed = await parseBridgeProbeReply({
      apiCompat,
      modelId: input.route.modelId,
      anthropicRequest,
      response,
      preferStream,
      ...(input.onTextDelta && { onTextDelta: input.onTextDelta }),
    });

    if (parsed.upstreamError) {
      logUpstreamError(`${input.logEventPrefix}-upstream-error`, {
        role: input.route.role,
        provider: input.route.provider.name,
        modelId: input.route.modelId,
        apiCompat,
        error: parsed.upstreamError,
      });
      return { ok: false, upstreamError: parsed.upstreamError };
    }

    const text = parsed.reply?.trim();
    if (!text) {
      logUpstreamError(`${input.logEventPrefix}-invalid`, {
        role: input.route.role,
        provider: input.route.provider.name,
        modelId: input.route.modelId,
        apiCompat,
        reason: "empty-reply",
      });
      return { ok: false };
    }

    logUpstream(`${input.logEventPrefix}-response`, {
      role: input.route.role,
      provider: input.route.provider.name,
      modelId: input.route.modelId,
      apiCompat,
      text,
    });
    return { ok: true, text };
  } catch (error) {
    logUpstreamError(`${input.logEventPrefix}-fetch-error`, {
      role: input.route.role,
      provider: input.route.provider.name,
      modelId: input.route.modelId,
      apiCompat,
      url: requestUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false };
  }
}
