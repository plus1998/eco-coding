import { createHash, randomInt } from "node:crypto";
import http, { type IncomingHttpHeaders } from "node:http";
import type { AgentRole } from "../shared/ipc";
import { dedupeUpstreamModels, fetchUpstreamModelsFromCredentials } from "./provider-models";
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
}

export interface AnthropicProxyResolvedRoute extends AnthropicProxyRoute {
  aliasModelId: string;
}

export interface StartedAnthropicProxy {
  apiKey: string;
  baseUrl: string;
  routes: AnthropicProxyResolvedRoute[];
  close(): Promise<void>;
}

const LOCAL_PROXY_API_KEY = "eco-local-model-router";
const ANTHROPIC_VERSION = "2023-06-01";

export async function startAnthropicModelProxy(
  routes: readonly AnthropicProxyRoute[],
): Promise<StartedAnthropicProxy> {
  const resolvedRoutes = routes.map((route) => ({
    ...route,
    aliasModelId: createModelAlias(route.role, route.provider.id, route.modelId),
  }));
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
      await forwardAnthropicRequest(request, response, route, body, requestedModel);
    } catch (error) {
      logUpstream("handler-error", { error: errorMessage(error) });
      writeJson(response, 500, { error: errorMessage(error) });
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
    if (!route.provider.enabled || !route.provider.apiKey || providersSeen.has(route.provider.id)) {
      continue;
    }
    providersSeen.add(route.provider.id);
    const result = await fetchUpstreamModelsFromCredentials(route.provider.baseUrl, route.provider.apiKey);
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
): Promise<void> {
  const upstreamUrl = `${trimTrailingSlash(route.provider.baseUrl)}${request.url ?? ""}`;
  const requestPayload = JSON.stringify(body);
  const upstreamHeaders = buildUpstreamHeaders(request.headers, route.provider.apiKey);

  logUpstream("request", {
    route: {
      role: route.role,
      provider: route.provider.name,
      providerId: route.provider.id,
      baseUrl: route.provider.baseUrl,
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

  const upstreamResponse = await fetch(upstreamUrl, {
    method: "POST",
    headers: upstreamHeaders,
    body: requestPayload,
  });

  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const isEventStream = contentType.includes("text/event-stream");

  if (!upstreamResponse.ok || !isEventStream) {
    const responseText = await upstreamResponse.text();
    logUpstream("response", {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      contentType,
      headers: Object.fromEntries(upstreamResponse.headers.entries()),
      body: parseJsonForLog(responseText) ?? truncateForLog(responseText),
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
  for await (const chunk of upstreamResponse.body as unknown as AsyncIterable<Uint8Array>) {
    if (!loggedStreamPreview) {
      logUpstream("response-stream-preview", {
        preview: Buffer.from(chunk).toString("utf8", 0, Math.min(chunk.byteLength, 800)),
      });
      loggedStreamPreview = true;
    }
    response.write(chunk);
  }
  response.end();
}

function buildUpstreamHeaders(headers: IncomingHttpHeaders, apiKey: string): Headers {
  const upstreamHeaders = new Headers();
  for (const name of ["accept", "anthropic-beta", "anthropic-version", "user-agent"]) {
    const value = headers[name];
    if (typeof value === "string") upstreamHeaders.set(name, value);
  }
  upstreamHeaders.set("content-type", "application/json");
  upstreamHeaders.set("anthropic-version", upstreamHeaders.get("anthropic-version") ?? ANTHROPIC_VERSION);
  upstreamHeaders.set("x-api-key", apiKey);
  upstreamHeaders.set("authorization", `Bearer ${apiKey}`);
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
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
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
