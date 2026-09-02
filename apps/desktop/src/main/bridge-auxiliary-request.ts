/**
 * Product auxiliary LLM calls (title, compact summary, git commit, approval).
 * Always go through the Eco SDK Bridge → embedded Gateway (1B).
 * Never post conversion payloads directly to the provider.
 */
import {
  GATEWAY_PROVIDER_ID_HEADER,
  GATEWAY_REQUESTED_MODEL_HEADER,
  GATEWAY_UPSTREAM_KIND_HEADER,
  mapApiCompatToUpstreamKind,
} from "@eco/gateway";
import { resolveUpstreamApiCompat, type UpstreamApiCompat } from "../shared/api-compat";
import { type AnthropicProxyRoute, applyRouteMaxOutputTokens } from "./anthropic-proxy";
import { ensureGlobalEcoGateway, getGlobalEcoBridgeBaseUrl } from "./eco-gateway-lifecycle";
import { applyProxyCchToAnthropicMessagesBody } from "./proxy-cch-audit";
import { headersToLoggable, logUpstream, logUpstreamError, truncateForLog } from "./upstream-log";

type Fetcher = typeof fetch;

export function resolveRouteApiCompat(route: AnthropicProxyRoute): UpstreamApiCompat {
  return resolveUpstreamApiCompat(route.apiCompat, route.provider.apiCompat);
}

export interface PostAuxiliaryBridgeRequestInput {
  route: AnthropicProxyRoute;
  anthropicBody: Record<string, unknown>;
  signal?: AbortSignal;
  /** Extra client headers forwarded on the Bridge request (e.g. structured-outputs beta). */
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
  error?: string;
}

export async function postAuxiliaryBridgeRequest(
  input: PostAuxiliaryBridgeRequestInput,
): Promise<PostAuxiliaryBridgeRequestResult> {
  const fetcher = input.fetcher ?? fetch;
  const apiCompat = resolveRouteApiCompat(input.route);
  const upstreamKind = mapApiCompatToUpstreamKind(
    apiCompat as "anthropic" | "openai_responses" | "openai_chat_completions",
  );

  let bridgeBaseUrl = "http://eco-bridge.test";
  try {
    await ensureGlobalEcoGateway({
      requiredProviderIds: [input.route.provider.id],
    });
    bridgeBaseUrl = getGlobalEcoBridgeBaseUrl();
  } catch (error) {
    if (!input.fetcher) {
      const message = error instanceof Error ? error.message : String(error);
      logUpstreamError(`${input.logEventPrefix}-gateway-unavailable`, {
        role: input.route.role,
        provider: input.route.provider.name,
        modelId: input.route.modelId,
        error: message,
      });
      return { ok: false, error: message };
    }
  }

  const requestUrl = `${bridgeBaseUrl}/v1/messages`;

  let body: Record<string, unknown> = {
    ...input.anthropicBody,
    model: input.route.modelId,
    stream: false,
  };
  applyRouteMaxOutputTokens(body, input.route.maxOutputTokens);
  body = applyProxyCchToAnthropicMessagesBody(body);

  // real upstream model only — never synthetic eco-aux-* (must not participate in resolution)
  const headers: Record<string, string> = {
    "content-type": "application/json",
    [GATEWAY_PROVIDER_ID_HEADER]: input.route.provider.id,
    [GATEWAY_UPSTREAM_KIND_HEADER]: upstreamKind,
    [GATEWAY_REQUESTED_MODEL_HEADER]: input.route.modelId,
  };
  if (input.anthropicExtraHeaders) {
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
    via: "eco-bridge",
    url: requestUrl,
    headers: headersToLoggable(headers),
    anthropicBody: body,
  });

  try {
    const response = await fetcher(requestUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
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
      return { ok: false, status: response.status, error: truncateForLog(raw) };
    }

    const text = await readAnthropicMessagesText(response, input.onTextDelta);
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
      via: "eco-bridge",
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
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Bridge /v1/messages returns Anthropic Messages wire (Gateway converts as needed).
 */
async function readAnthropicMessagesText(
  response: Response,
  onTextDelta?: (delta: string, text: string) => void,
): Promise<string | undefined> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream") && response.body) {
    return collectAnthropicSseText(response, onTextDelta);
  }

  const raw = await response.text();
  try {
    const message = JSON.parse(raw) as {
      type?: string;
      content?: Array<{ type?: string; text?: string; thinking?: string }>;
      error?: { message?: string };
    };
    if (message.error?.message) {
      return undefined;
    }
    const text = extractAnthropicContentText(message.content);
    if (text) {
      onTextDelta?.(text, text);
    }
    return text;
  } catch {
    return undefined;
  }
}

async function collectAnthropicSseText(
  response: Response,
  onTextDelta?: (delta: string, text: string) => void,
): Promise<string | undefined> {
  const parts: string[] = [];
  const thinkingParts: string[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice("data:".length).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload) as {
            type?: string;
            delta?: { type?: string; text?: string; thinking?: string };
          };
          if (event.type === "content_block_delta") {
            if (event.delta?.type === "text_delta" && event.delta.text) {
              parts.push(event.delta.text);
              onTextDelta?.(event.delta.text, parts.join(""));
            }
            if (event.delta?.type === "thinking_delta" && event.delta.thinking) {
              thinkingParts.push(event.delta.thinking);
            }
          }
        } catch {
          // skip bad event
        }
      }
    }
  }
  const text = parts.join("").trim() || thinkingParts.join("").trim();
  return text || undefined;
}

function extractAnthropicContentText(
  content: Array<{ type?: string; text?: string; thinking?: string }> | undefined,
): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }
  const texts: string[] = [];
  const thinking: string[] = [];
  for (const block of content) {
    if (block.type === "text" && block.text?.trim()) {
      texts.push(block.text.trim());
    }
    if (block.type === "thinking" && block.thinking?.trim()) {
      thinking.push(block.thinking.trim());
    }
  }
  if (texts.length > 0) {
    return texts.join("\n").trim();
  }
  if (thinking.length > 0) {
    return thinking.join("\n").trim();
  }
  return undefined;
}
