import { createHash, randomInt } from "node:crypto";
import http, { type IncomingHttpHeaders } from "node:http";
import type { AgentRole } from "../shared/ipc";
import type { ProviderConfigSecret } from "./provider-store";

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
      if (request.method === "GET" && request.url === "/health") {
        writeJson(response, 200, { ok: true });
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
        writeJson(response, 400, {
          error: `No provider route configured for model ${requestedModel ?? "<missing>"}.`,
        });
        return;
      }

      body.model = route.modelId;
      await forwardAnthropicRequest(request, response, route, body);
    } catch (error) {
      writeJson(response, 500, { error: errorMessage(error) });
    }
  });

  await listenOnAvailablePort(server);

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to start local model router.");
  }

  return {
    apiKey: LOCAL_PROXY_API_KEY,
    baseUrl: `http://127.0.0.1:${address.port}`,
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
  return routes.find((route) => route.aliasModelId === requestedModel || route.modelId === requestedModel);
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
): Promise<void> {
  const upstreamResponse = await fetch(`${trimTrailingSlash(route.provider.baseUrl)}${request.url ?? ""}`, {
    method: "POST",
    headers: buildUpstreamHeaders(request.headers, route.provider.apiKey),
    body: JSON.stringify(body),
  });

  response.writeHead(upstreamResponse.status, responseHeaders(upstreamResponse.headers));
  if (!upstreamResponse.body) {
    response.end();
    return;
  }

  for await (const chunk of upstreamResponse.body as unknown as AsyncIterable<Uint8Array>) {
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
