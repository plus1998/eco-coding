import { createHash, randomInt } from "node:crypto";
import http from "node:http";
import { applyThinkingToMessagesBody, type ParsedUsage } from "@eco/runtime";
import { resolveUpstreamApiCompat, type UpstreamApiCompat } from "../shared/api-compat";
import type { AgentRole, PromptImageAttachment, ThinkingEffort } from "../shared/ipc";
import { forwardMessagesViaBridge, type BridgeForwardRoute } from "./bridge-upstream";
import { dedupeUpstreamModels, fetchUpstreamModelsFromCredentials } from "./provider-models";
import type { ProviderConfigSecret } from "./provider-store";
import type { UpstreamModelOption } from "../shared/models";
import {
  logUpstreamProxyCall,
  proxyCallCommonFields,
  type UpstreamProxyCallBilling,
} from "./upstream-proxy-log";
import {
  announceUpstreamLogDestination,
  formatUpstreamFetchError,
  logUpstream,
  logUpstreamError,
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
  statusCode?: number;
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

export type AnthropicProxyUsageHandler = (
  info: AnthropicProxyUsageInfo,
) => void | Promise<UpstreamProxyCallBilling | null | undefined>;

export interface AnthropicProxyStartOptions {
  pendingImages?: readonly PromptImageAttachment[];
  /**
   * Local count_tokens stub: SDK context meter is authoritative via usage.recorded;
   * return a non-zero estimate so Claude Code does not see perpetual 0 occupancy.
   */
  resolveCountTokensInput?: (input: {
    role: AgentRole;
    body: Record<string, unknown>;
  }) => number | undefined;
  /** Non-empty: overrides SDK User-Agent on upstream requests. */
  upstreamUserAgent?: string;
  /** Fires when the local proxy forwards a streaming Messages API call upstream. */
  onMessagesRequest?: (info: AnthropicProxyMessagesRequestInfo) => void;
  /** Fires when the upstream fetch fails before a response body is returned. */
  onUpstreamConnectionError?: (info: AnthropicProxyUpstreamErrorInfo) => void;
  /** Fires after a Messages API response exposes provider-reported token usage. */
  onUsage?: AnthropicProxyUsageHandler;
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
const MAX_PENDING_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export async function startAnthropicModelProxy(
  routes: readonly AnthropicProxyRoute[],
  options?: AnthropicProxyStartOptions,
): Promise<StartedAnthropicProxy> {
  const onMessagesRequest = options?.onMessagesRequest;
  const onUpstreamConnectionError = options?.onUpstreamConnectionError;
  const onUsage = options?.onUsage;
  const upstreamUserAgent = options?.upstreamUserAgent?.trim() || undefined;
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
        logUpstreamError("route-miss", {
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

      const countTokensRequest = isCountTokensPath(request.url);

      if (
        (isMessagesPath(request.url) || countTokensRequest) &&
        pendingImages.length > 0 &&
        !imagesInjected
      ) {
        injectImagesIntoMessagesBody(body, pendingImages);
        imagesInjected = true;
        pendingImages = [];
      }

      if (!countTokensRequest) {
        applyThinkingToMessagesBody(body, route.thinkingEffort);
      }

      const bridgeRoute: BridgeForwardRoute = {
        role: route.role,
        provider: route.provider,
        modelId: route.modelId,
        apiCompat: route.apiCompat,
        aliasModelId: route.aliasModelId,
      };
      const bridgeCtx = {
        route: bridgeRoute,
        body,
        requestUrl: request.url,
        requestedModel,
        ...(upstreamUserAgent ? { upstreamUserAgent } : {}),
        ...(onUpstreamConnectionError && {
          onUpstreamConnectionError: (info) => {
            onUpstreamConnectionError({
              role: info.role,
              error: info.error,
              ...(info.statusCode !== undefined && { statusCode: info.statusCode }),
            });
          },
        }),
        onUsage: onUsage
          ? async (info: {
              role: AgentRole;
              providerId: string;
              providerName: string;
              providerBaseUrl: string;
              modelId: string;
              requestedModel?: string;
              requestId?: string;
              usage: ParsedUsage;
            }) =>
              (await onUsage({
                role: info.role,
                providerId: info.providerId,
                providerName: info.providerName,
                providerBaseUrl: info.providerBaseUrl,
                modelId: info.modelId,
                ...(info.requestedModel && { requestedModel: info.requestedModel }),
                ...(info.requestId && { requestId: info.requestId }),
                usage: info.usage,
              })) ?? null
          : undefined,
      };

      if (countTokensRequest) {
        const inputTokens = resolveCountTokensStubInput(body, route.role, options?.resolveCountTokensInput);
        logUpstreamProxyCall({
          at: new Date().toISOString(),
          ok: true,
          elapsedMs: 0,
          ...proxyCallCommonFields({
            role: route.role,
            provider: bridgeRoute.provider,
            apiCompat: bridgeRoute.apiCompat,
            modelId: bridgeRoute.modelId,
            aliasModelId: bridgeRoute.aliasModelId,
            requestedModel,
            requestUrl: request.url,
            upstreamUrl: "eco://local/count_tokens-stub",
            stream: false,
            converted: false,
          }),
          http: { status: 200, streaming: false },
          tokens: { input: inputTokens, output: 0, cacheRead: 0, cacheCreation: 0 },
          billing: null,
        });
        writeJson(response, 200, { input_tokens: inputTokens });
        return;
      }

      if (onMessagesRequest && isMessagesPath(request.url) && body.stream === true) {
        onMessagesRequest({ role: route.role, modelId: route.modelId });
      }
      await forwardMessagesViaBridge(request, response, bridgeCtx);
    } catch (error) {
      if (request.aborted) {
        logUpstream("handler-aborted", { error: errorMessage(error) });
        endHttpResponse(response);
        return;
      }
      logUpstreamError("handler-error", { error: errorMessage(error) });
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

/**
 * Model ids Claude Agent SDK may request for builtin Explore even when Eco routes explore elsewhere.
 * Users never configure these directly; the proxy maps them to the explore role route.
 */
export const SDK_BUILTIN_EXPLORE_MODEL_IDS = new Set(["gpt-5.4"]);

/** Family ids SDK may request when the configured route uses a suffixed variant (e.g. gpt-5.4-mini → gpt-5.4). */
export function canonicalModelFamilyIds(modelId: string): readonly string[] {
  const match = modelId.match(
    /^(?<family>.+)-(?:mini|nano|turbo|fast|lite|small|large|medium|preview)$/i,
  );
  const family = match?.groups?.family?.trim();
  return family ? [family] : [];
}

/** When several roles share one upstream model id, prefer explore for canonical family ids (SDK builtin Explore). */
const SHARED_UPSTREAM_MODEL_ROLE_PRIORITY: readonly AgentRole[] = [
  "explore",
  "coder",
  "tester",
  "architect",
  "reviewer",
  "planner",
];

function pickSharedUpstreamModelRoute(
  routes: readonly AnthropicProxyResolvedRoute[],
): AnthropicProxyResolvedRoute | undefined {
  if (routes.length === 0) {
    return undefined;
  }
  const uniqueModelIds = new Set(routes.map((route) => route.modelId));
  if (uniqueModelIds.size !== 1) {
    return undefined;
  }
  for (const role of SHARED_UPSTREAM_MODEL_ROLE_PRIORITY) {
    const match = routes.find((route) => route.role === role);
    if (match) {
      return match;
    }
  }
  return routes[0];
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

  const byExactModelId = routes.filter((route) => route.modelId === requestedModel);
  if (byExactModelId.length === 1) {
    return byExactModelId[0];
  }
  if (byExactModelId.length > 1) {
    return pickSharedUpstreamModelRoute(byExactModelId);
  }

  const familyPrefix = `${requestedModel}-`;
  const byFamilyVariant = routes.filter((route) => route.modelId.startsWith(familyPrefix));
  if (byFamilyVariant.length === 1) {
    return byFamilyVariant[0];
  }
  if (byFamilyVariant.length > 1) {
    return pickSharedUpstreamModelRoute(byFamilyVariant);
  }

  if (SDK_BUILTIN_EXPLORE_MODEL_IDS.has(requestedModel)) {
    return routes.find((route) => route.role === "explore");
  }

  return undefined;
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

/** Rough token estimate from count_tokens / messages request JSON (chars / 4). */
export function estimateInputTokensFromAnthropicBody(body: Record<string, unknown>): number {
  const parts: string[] = [];
  if (typeof body.system === "string") {
    parts.push(body.system);
  } else if (Array.isArray(body.system)) {
    parts.push(JSON.stringify(body.system));
  }
  if (Array.isArray(body.tools)) {
    parts.push(JSON.stringify(body.tools));
  }
  if (Array.isArray(body.messages)) {
    parts.push(JSON.stringify(body.messages));
  }
  const text = parts.join("\n");
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

function resolveCountTokensStubInput(
  body: Record<string, unknown>,
  role: AgentRole,
  resolve?: AnthropicProxyStartOptions["resolveCountTokensInput"],
): number {
  const fromHook = resolve?.({ role, body });
  if (typeof fromHook === "number" && Number.isFinite(fromHook) && fromHook >= 0) {
    return Math.trunc(fromHook);
  }
  return estimateInputTokensFromAnthropicBody(body);
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

export { createStreamingUsageTracker, extractUsageFromResponseBody } from "./anthropic-usage";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAddressInUse(error: unknown): boolean {
  return isRecord(error) && error.code === "EADDRINUSE";
}

function errorMessage(error: unknown): string {
  return formatUpstreamFetchError(error);
}
