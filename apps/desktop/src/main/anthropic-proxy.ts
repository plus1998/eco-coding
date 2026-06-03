import { createHash, randomInt } from "node:crypto";
import http, { type IncomingHttpHeaders } from "node:http";
import { applyThinkingToMessagesBody, type ParsedUsage } from "@eco/runtime";
import {
  isOpenAICompat,
  resolveUpstreamApiCompat,
  type UpstreamApiCompat,
} from "../shared/api-compat";
import type { AgentRole, PromptImageAttachment, ThinkingEffort } from "../shared/ipc";
import { createStreamingUsageTracker, extractUsageFromResponseBody } from "./anthropic-usage";
import { forwardMessagesViaOpenAICompat } from "./model-upstream-openai";
import { dedupeUpstreamModels, fetchUpstreamModelsFromCredentials } from "./provider-models";
import { buildProviderRequestBaseUrl } from "./provider-models";
import type { ProviderConfigSecret } from "./provider-store";
import type { UpstreamModelOption } from "../shared/models";
import {
  announceUpstreamLogDestination,
  headersToLoggable,
  logUpstream,
  parseJsonForLog,
  truncateForLog,
} from "./upstream-log";

export interface AnthropicProxyRoute {
  role: AgentRole;
  provider: ProviderConfigSecret;
  modelId: string;
  apiCompat?: UpstreamApiCompat;
  thinkingEffort?: ThinkingEffort;
}

export interface AnthropicProxyMessagesRequestInfo {
  role: AgentRole;
  modelId: string;
}

export interface AnthropicProxyUpstreamErrorInfo {
  role: AgentRole;
  error: string;
}

export interface AnthropicProxyUsageInfo {
  role: AgentRole;
  providerId: string;
  providerName: string;
  providerBaseUrl: string;
  modelId: string;
  requestedModel?: string;
  requestId?: string;
  usage: ParsedUsage;
}

export interface AnthropicProxyStartOptions {
  pendingImages?: readonly PromptImageAttachment[];
  /** Fires when the local proxy forwards a streaming Messages API call upstream. */
  onMessagesRequest?: (info: AnthropicProxyMessagesRequestInfo) => void;
  /** Fires when the upstream fetch fails before a response body is returned. */
  onUpstreamConnectionError?: (info: AnthropicProxyUpstreamErrorInfo) => void;
  /** Fires after a Messages API response exposes provider-reported token usage. */
  onUsage?: (info: AnthropicProxyUsageInfo) => void;
}

export interface AnthropicProxyResolvedRoute extends AnthropicProxyRoute {
  aliasModelId: string;
  apiCompat: UpstreamApiCompat;
}

export interface StartedAnthropicProxy {
  apiKey: string;
  baseUrl: string;
  routes: AnthropicProxyResolvedRoute[];
  close(): Promise<void>;
}

const LOCAL_PROXY_API_KEY = "eco-local-model-router";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_PENDING_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export async function startAnthropicModelProxy(
  routes: readonly AnthropicProxyRoute[],
  options?: AnthropicProxyStartOptions,
): Promise<StartedAnthropicProxy> {
  const onMessagesRequest = options?.onMessagesRequest;
  const onUpstreamConnectionError = options?.onUpstreamConnectionError;
  const onUsage = options?.onUsage;
  const resolvedRoutes: AnthropicProxyResolvedRoute[] = routes.map((route) => ({
    role: route.role,
    provider: route.provider,
    modelId: route.modelId,
    apiCompat: resolveUpstreamApiCompat(route.apiCompat, route.provider.apiCompat),
    aliasModelId: createModelAlias(route.role, route.provider.id, route.modelId),
    ...(route.thinkingEffort && { thinkingEffort: route.thinkingEffort }),
  }));
  let pendingImages = normalizePendingImages(options?.pendingImages);
  let imagesInjected = false;

  const server = http.createServer(async (request, response) => {
    try {
      const isHealthCheck = request.method === "GET" && request.url === "/health";
      if (!isHealthCheck) {
        logUpstream("incoming", {
          method: request.method,
          url: request.url,
        });
      }

      if (isHealthCheck) {
        writeJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && isModelsListPath(request.url)) {
        const upstreamModels = await loadUpstreamModelsForRoutes(resolvedRoutes);
        writeJson(response, 200, buildModelsListResponse(resolvedRoutes, upstreamModels));
        return;
      }

      if (request.method !== "POST") {
        writeJson(response, 405, { error: "Only POST requests are supported." });
        return;
      }

      const body = await readJsonBody(request);
      const requestedModel = typeof body.model === "string" ? body.model : undefined;
      const route = resolveProxyRoute(resolvedRoutes, requestedModel);

      if (!route) {
        logUpstream("route-miss", {
          requestedModel,
          configuredModels: resolvedRoutes.map((entry) => ({
            role: entry.role,
            alias: entry.aliasModelId,
            modelId: entry.modelId,
          })),
        });
        writeJson(response, 400, {
          error: `No provider route configured for model ${requestedModel ?? "<missing>"}.`,
        });
        return;
      }

      const upstreamModel = route.modelId;
      body.model = upstreamModel;

      if (isMessagesPath(request.url) && pendingImages.length > 0 && !imagesInjected) {
        injectImagesIntoMessagesBody(body, pendingImages);
        imagesInjected = true;
        pendingImages = [];
      }

      const countTokensRequest = isCountTokensPath(request.url);

      if (!countTokensRequest && !isOpenAICompat(route.apiCompat)) {
        applyThinkingToMessagesBody(body, route.thinkingEffort);
      }

      if (countTokensRequest) {
        await forwardAnthropicRequest(
          request,
          response,
          route,
          body,
          requestedModel,
          onMessagesRequest,
          onUpstreamConnectionError,
          onUsage,
        );
        return;
      }

      if (isOpenAICompat(route.apiCompat)) {
        if (onMessagesRequest && isMessagesPath(request.url) && body.stream === true) {
          onMessagesRequest({ role: route.role, modelId: route.modelId });
        }
        await forwardMessagesViaOpenAICompat(request, response, {
          route,
          body,
          requestedModel,
          onUsage: onUsage
            ? (info) =>
                onUsage({
                  role: info.role,
                  providerId: info.providerId,
                  providerName: info.providerName,
                  providerBaseUrl: info.providerBaseUrl,
                  modelId: info.modelId,
                  ...(info.requestedModel && { requestedModel: info.requestedModel }),
                  ...(info.requestId && { requestId: info.requestId }),
                  usage: info.usage,
                })
            : undefined,
        });
        return;
      }

      await forwardAnthropicRequest(
        request,
        response,
        route,
        body,
        requestedModel,
        onMessagesRequest,
        onUpstreamConnectionError,
        onUsage,
      );
    } catch (error) {
      if (request.aborted) {
        logUpstream("handler-aborted", { error: errorMessage(error) });
        endHttpResponse(response);
        return;
      }
      logUpstream("handler-error", { error: errorMessage(error) });
      if (!response.headersSent) {
        writeJson(response, 500, { error: errorMessage(error) });
      } else {
        endHttpResponse(response);
      }
    }
  });

  await listenOnAvailablePort(server);

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to start local model router.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  announceUpstreamLogDestination({
    proxyBaseUrl: baseUrl,
    routeCount: resolvedRoutes.length,
    routes: resolvedRoutes.map((entry) => ({
      role: entry.role,
      alias: entry.aliasModelId,
      modelId: entry.modelId,
      apiCompat: entry.apiCompat,
      provider: entry.provider.name,
    })),
  });

  return {
    apiKey: LOCAL_PROXY_API_KEY,
    baseUrl,
    routes: resolvedRoutes,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export function createModelAlias(role: AgentRole, providerId: string, modelId: string): string {
  const digest = createHash("sha256").update(`${role}:${providerId}:${modelId}`).digest("hex").slice(0, 12);
  return `eco-${role}-${digest}`;
}

export function resolveProxyRoute(
  routes: readonly AnthropicProxyResolvedRoute[],
  requestedModel: string | undefined,
): AnthropicProxyResolvedRoute | undefined {
  if (!requestedModel) return undefined;

  const byAlias = routes.find((route) => route.aliasModelId === requestedModel);
  if (byAlias) {
    return byAlias;
  }

  // Multiple roles may share the same upstream model id; the first configured role wins.
  return routes.find((route) => route.modelId === requestedModel);
}

export function buildModelsListResponse(
  routes: readonly AnthropicProxyResolvedRoute[],
  upstreamModels: readonly UpstreamModelOption[] = [],
): {
  data: Array<{ id: string; display_name: string; type: string }>;
  has_more: boolean;
  first_id: string;
  last_id: string;
} {
  const seen = new Set<string>();
  const data: Array<{ id: string; display_name: string; type: string }> = [];

  const pushModel = (id: string, display_name: string) => {
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    data.push({ id, display_name, type: "model" });
  };

  for (const model of upstreamModels) {
    pushModel(model.id, model.displayName ?? model.id);
  }

  for (const route of routes) {
    pushModel(route.aliasModelId, `${route.role} · ${route.provider.name} → ${route.modelId}`);
    if (!seen.has(route.modelId)) {
      pushModel(route.modelId, `${route.role} · ${route.provider.name} / ${route.modelId}`);
    }
  }

  const firstId = data[0]?.id ?? "";
  const lastId = data[data.length - 1]?.id ?? firstId;
  return { data, has_more: false, first_id: firstId, last_id: lastId };
}

async function loadUpstreamModelsForRoutes(
  routes: readonly AnthropicProxyResolvedRoute[],
): Promise<UpstreamModelOption[]> {
  const providersSeen = new Set<string>();
  const collected: UpstreamModelOption[] = [];

  for (const route of routes) {
    if (!route.provider.enabled || providersSeen.has(route.provider.id)) {
      continue;
    }
    providersSeen.add(route.provider.id);
    const result = await fetchUpstreamModelsFromCredentials(
      route.provider.baseUrl,
      route.provider.apiKey,
      route.provider.requestPath,
    );
    if (result.ok) {
      collected.push(...result.models);
      logUpstream("models-list-upstream", {
        providerId: route.provider.id,
        provider: route.provider.name,
        count: result.models.length,
      });
    } else {
      logUpstream("models-list-upstream-error", {
        providerId: route.provider.id,
        provider: route.provider.name,
        error: result.error,
      });
    }
  }

  return dedupeUpstreamModels(collected);
}

function isModelsListPath(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  const pathname = url.split("?")[0] ?? url;
  return pathname === "/v1/models" || pathname.endsWith("/v1/models");
}

function isMessagesPath(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  const pathname = url.split("?")[0] ?? url;
  return pathname === "/v1/messages" || pathname.endsWith("/v1/messages");
}

function isCountTokensPath(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  return url.split("?")[0]?.includes("/count_tokens") === true;
}

export function injectImagesIntoMessagesBody(
  body: Record<string, unknown>,
  images: readonly PromptImageAttachment[],
): void {
  const messages = body.messages;
  if (!Array.isArray(messages) || images.length === 0) {
    return;
  }

  let targetIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isRecord(message) && message.role === "user") {
      targetIndex = index;
      break;
    }
  }
  if (targetIndex < 0) {
    return;
  }

  const message = messages[targetIndex];
  if (!isRecord(message)) {
    return;
  }

  const imageBlocks = images.map((image) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: image.mediaType,
      data: image.data,
    },
  }));

  const existing = message.content;
  if (typeof existing === "string") {
    message.content = [...imageBlocks, { type: "text", text: existing }];
    return;
  }

  if (Array.isArray(existing)) {
    message.content = [...imageBlocks, ...existing];
    return;
  }

  message.content = imageBlocks;
}

function normalizePendingImages(
  images: readonly PromptImageAttachment[] | undefined,
): PromptImageAttachment[] {
  if (!images?.length) {
    return [];
  }
  const normalized: PromptImageAttachment[] = [];
  for (const image of images.slice(0, MAX_PENDING_IMAGES)) {
    const data = image.data?.trim();
    if (!data || !image.mediaType) {
      continue;
    }
    const byteLength = Buffer.byteLength(data, "base64");
    if (byteLength > MAX_IMAGE_BYTES) {
      continue;
    }
    normalized.push({ mediaType: image.mediaType, data });
  }
  return normalized;
}

async function listenOnAvailablePort(server: http.Server): Promise<void> {
  const startPort = randomInt(20_000, 60_000);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const port = 20_000 + ((startPort + attempt) % 40_000);
    try {
      await listen(server, port);
      return;
    } catch (error) {
      if (!isAddressInUse(error)) throw error;
    }
  }

  throw new Error("Unable to find an available local port for the model router.");
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function forwardAnthropicRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  route: AnthropicProxyResolvedRoute,
  body: Record<string, unknown>,
  requestedModel?: string,
  onMessagesRequest?: (info: AnthropicProxyMessagesRequestInfo) => void,
  onUpstreamConnectionError?: (info: AnthropicProxyUpstreamErrorInfo) => void,
  onUsage?: (info: AnthropicProxyUsageInfo) => void,
): Promise<void> {
  const upstreamRoot = buildProviderRequestBaseUrl(route.provider.baseUrl, route.provider.requestPath);
  const upstreamUrl = `${trimTrailingSlash(upstreamRoot)}${request.url ?? ""}`;
  const requestPayload = JSON.stringify(body);
  const upstreamHeaders = buildUpstreamHeaders(request.headers, route.provider.apiKey);

  if (onMessagesRequest && isMessagesPath(request.url) && body.stream === true) {
    onMessagesRequest({ role: route.role, modelId: route.modelId });
  }

  logUpstream("request", {
    route: {
      role: route.role,
      provider: route.provider.name,
      providerId: route.provider.id,
      baseUrl: route.provider.baseUrl,
      apiCompat: route.apiCompat,
    },
    model: {
      sdkRequested: requestedModel,
      upstream: body.model,
      alias: route.aliasModelId,
    },
    url: upstreamUrl,
    headers: headersToLoggable(upstreamHeaders),
    body: parseJsonForLog(requestPayload),
  });

  const upstreamAbort = linkClientAbortToUpstream(request, response);

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: requestPayload,
      signal: upstreamAbort.signal,
    });
  } catch (error) {
    if (upstreamAbort.signal.aborted) {
      return;
    }
    const fetchError = errorMessage(error);
    if (onUpstreamConnectionError && isMessagesPath(request.url)) {
      onUpstreamConnectionError({ role: route.role, error: fetchError });
    }
    throw error;
  } finally {
    upstreamAbort.dispose();
  }

  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const isEventStream = contentType.includes("text/event-stream");
  const requestId = upstreamResponse.headers.get("x-request-id") ?? upstreamResponse.headers.get("request-id") ?? undefined;

  if (!upstreamResponse.ok || !isEventStream) {
    const responseText = await upstreamResponse.text();
    const parsedBody = parseJsonForLog(responseText);
    const usage = upstreamResponse.ok && isMessagesPath(request.url) ? extractUsageFromResponseBody(parsedBody) : null;
    if (usage && onUsage) {
      onUsage(buildUsageInfo(route, usage, requestedModel, requestId));
    }
    logUpstream("response", {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      contentType,
      headers: Object.fromEntries(upstreamResponse.headers.entries()),
      body: parsedBody ?? truncateForLog(responseText),
    });
    response.writeHead(upstreamResponse.status, responseHeaders(upstreamResponse.headers));
    response.end(responseText);
    return;
  }

  logUpstream("response", {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    contentType,
    body: "(streaming)",
  });

  response.writeHead(upstreamResponse.status, responseHeaders(upstreamResponse.headers));
  if (!upstreamResponse.body) {
    response.end();
    return;
  }

  let loggedStreamPreview = false;
  const usageTracker = createStreamingUsageTracker();
  try {
    for await (const chunk of upstreamResponse.body as unknown as AsyncIterable<Uint8Array>) {
      if (!loggedStreamPreview) {
        logUpstream("response-stream-preview", {
          preview: Buffer.from(chunk).toString("utf8", 0, Math.min(chunk.byteLength, 800)),
        });
        loggedStreamPreview = true;
      }
      if (onUsage && isMessagesPath(request.url)) {
        usageTracker.push(chunk);
      }
      if (!response.write(chunk)) {
        await waitForDrain(response);
      }
    }
    const usage = usageTracker.finish();
    if (usage && onUsage) {
      onUsage(buildUsageInfo(route, usage, requestedModel, requestId));
    }
  } catch (error) {
    if (upstreamAbort.signal.aborted) {
      logUpstream("stream-aborted", { reason: "client-disconnected" });
    } else {
      const streamError = errorMessage(error);
      logUpstream("stream-error", { error: streamError });
      if (onUpstreamConnectionError && isMessagesPath(request.url)) {
        onUpstreamConnectionError({ role: route.role, error: streamError });
      }
    }
  } finally {
    endHttpResponse(response);
  }
}

function buildUsageInfo(
  route: AnthropicProxyResolvedRoute,
  usage: ParsedUsage,
  requestedModel?: string,
  requestId?: string,
): AnthropicProxyUsageInfo {
  return {
    role: route.role,
    providerId: route.provider.id,
    providerName: route.provider.name,
    providerBaseUrl: route.provider.baseUrl,
    modelId: route.modelId,
    ...(requestedModel && { requestedModel }),
    ...(requestId && { requestId }),
    usage,
  };
}

export { createStreamingUsageTracker, extractUsageFromResponseBody } from "./anthropic-usage";

function buildUpstreamHeaders(headers: IncomingHttpHeaders, apiKey: string): Headers {
  const upstreamHeaders = new Headers();
  for (const name of ["accept", "anthropic-beta", "anthropic-version", "user-agent"]) {
    const value = headers[name];
    if (typeof value === "string") upstreamHeaders.set(name, value);
  }
  upstreamHeaders.set("content-type", "application/json");
  upstreamHeaders.set("anthropic-version", upstreamHeaders.get("anthropic-version") ?? ANTHROPIC_VERSION);
  const trimmedKey = apiKey.trim();
  if (trimmedKey) {
    upstreamHeaders.set("x-api-key", trimmedKey);
    upstreamHeaders.set("authorization", `Bearer ${trimmedKey}`);
  }
  return upstreamHeaders;
}

function responseHeaders(headers: Headers): Record<string, string> {
  const passthrough: Record<string, string> = {};
  for (const name of ["content-type", "cache-control", "x-request-id", "request-id"]) {
    const value = headers.get(name);
    if (value) passthrough[name] = value;
  }
  return passthrough;
}

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!isRecord(parsed)) {
    throw new Error("Expected a JSON object request body.");
  }
  return parsed;
}

function writeJson(response: http.ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  if (response.headersSent) {
    logUpstream("response-already-started", { statusCode });
    endHttpResponse(response);
    return;
  }
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function endHttpResponse(response: http.ServerResponse): void {
  if (!response.writableEnded) {
    response.end();
  }
}

function waitForDrain(response: http.ServerResponse): Promise<void> {
  if (response.writableEnded || response.writableFinished) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    response.once("drain", resolve);
  });
}

function linkClientAbortToUpstream(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };
  request.once("aborted", abort);
  response.once("close", () => {
    if (!response.writableFinished) {
      abort();
    }
  });
  return {
    signal: controller.signal,
    dispose: () => {
      request.off("aborted", abort);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAddressInUse(error: unknown): boolean {
  return isRecord(error) && error.code === "EADDRINUSE";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
