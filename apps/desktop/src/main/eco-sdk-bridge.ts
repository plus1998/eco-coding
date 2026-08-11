/**
 * Eco SDK Bridge — public HTTP face for Codex (Responses) and Claude (Messages).
 * Product layer: attribution + provider/model resolution, then in-process Gateway.
 */

import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CODEX_TURN_METADATA_HEADER,
  GATEWAY_PROVIDER_ID_HEADER,
  GATEWAY_REQUESTED_MODEL_HEADER,
  GATEWAY_THREAD_ID_HEADER,
  GATEWAY_UPSTREAM_KIND_HEADER,
  dispatchNodeRequest,
  mapApiCompatToUpstreamKind,
  parseCodexTurnMetadataHeader,
  type EcoGatewayServer,
  type UpstreamKind,
} from "@eco/gateway";
import type { CodexTurnRouteRegistry } from "@eco/runtime";
import {
  type CodexGatewayApiCompat,
  InvalidCodexGatewayModelAliasError,
  parseCodexGatewayModelAlias,
} from "@eco/shared";

export type BridgeLogFn = (message: string) => void;

export interface BridgeRouteResolution {
  providerId: string;
  upstreamModelId: string;
  upstreamKind?: UpstreamKind;
}

export interface EcoSdkBridgeOptions {
  gateway: EcoGatewayServer;
  /** Codex turn → route (provider + model). */
  turnRouteRegistry?: CodexTurnRouteRegistry;
  getTurnRouteRegistry?: () => CodexTurnRouteRegistry | undefined;
  /**
   * Optional product-layer resolver when headers/registry cannot resolve
   * (e.g. Claude stamp path, eco_{providerId} default model, models[] match).
   * Must not be the only long-term mechanism for unique billing attribution.
   */
  resolveRoute?: (input: {
    face: "responses" | "messages";
    model: string | undefined;
    headers: Headers;
  }) => BridgeRouteResolution | undefined;
  /** Provider table for product-layer eco_/models resolution (not used by gateway). */
  getProviders?: () => readonly { id: string; upstreamModelId: string; models: string[] }[];
  /**
   * Product prep for Claude Messages (alias resolve, images, thinking, count_tokens, models list).
   * Return early response or rewritten body + route resolution.
   */
  prepareClaudeMessages?: (input: {
    path: string;
    method: string;
    body: Record<string, unknown>;
    model: string | undefined;
  }) => Promise<
    | { kind: "response"; response: Response }
    | {
        kind: "forward";
        resolution: BridgeRouteResolution;
        clientModel: string;
        threadId?: string;
      }
    | { kind: "miss" }
  >;
  /** Eco owns compact — return a client-safe response without calling gateway. */
  handleCompact?: (request: Request) => Response | Promise<Response>;
  onLog?: BridgeLogFn;
}

export interface EcoSdkBridgeServer {
  port: number;
  baseUrl: string;
  stop: () => void;
  handleRequest: (request: Request) => Promise<Response>;
}

function defaultLog(message: string): void {
  process.stderr.write(`[eco-bridge] ${message}\n`);
}

/**
 * Codex may still POST `/v1/responses/compact`.
 * Eco owns compaction out-of-band (scheduler / thread/compact); this endpoint only
 * returns a non-fatal Responses compact wire so the SDK does not hang.
 * Never forwards to Gateway/upstream (plan 2A — no responses-native compact via gateway).
 */
export function buildEcoBridgeCompactInterceptResponse(requestBody?: {
  model?: unknown;
}): Response {
  const model =
    typeof requestBody?.model === "string" && requestBody.model.trim()
      ? requestBody.model.trim()
      : "eco-bridge-compact";
  const id = `eco_compact_intercept_${Date.now()}`;
  return Response.json({
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model,
    output: [
      {
        type: "compaction",
        id: `cmp_${id}`,
        encrypted_content: "eco_bridge_compact_intercept",
      },
    ],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    },
  });
}

/**
 * Create a Web-fetch handler that resolves provider/model then calls embedded gateway.
 */
export function createEcoSdkBridgeHandler(
  options: EcoSdkBridgeOptions,
): (request: Request) => Promise<Response> {
  const onLog = options.onLog ?? defaultLog;

  return async (request: Request) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (
      request.method === "POST" &&
      (path === "/v1/responses/compact" || path === "/responses/compact")
    ) {
      onLog("POST compact intercepted (Eco Bridge owns compaction; Eco compact runs out-of-band)");
      if (options.handleCompact) {
        return options.handleCompact(request);
      }
      let body: { model?: unknown } | undefined;
      try {
        body = (await request.json()) as { model?: unknown };
      } catch {
        body = undefined;
      }
      return buildEcoBridgeCompactInterceptResponse(body);
    }

    // Claude SDK models catalog: product aliases, not gateway concrete models.
    if (request.method === "GET" && path === "/v1/models" && options.prepareClaudeMessages) {
      const prepared = await options.prepareClaudeMessages({
        path,
        method: request.method,
        body: {},
        model: undefined,
      });
      if (prepared.kind === "response") {
        return prepared.response;
      }
    }

    // Health/models/providers passthrough without rewriting body.
    if (
      (request.method === "GET" &&
        (path === "/health" || path === "/v1/health" || path === "/v1/models")) ||
      (request.method === "PUT" && path === "/v1/providers")
    ) {
      return options.gateway.handleRequest(request);
    }

    if (
      request.method === "POST" &&
      (path === "/v1/responses" ||
        path === "/v1/messages" ||
        path === "/v1/messages/count_tokens")
    ) {
      const face: "responses" | "messages" =
        path === "/v1/responses" ? "responses" : "messages";
      return forwardWithResolvedRoute(request, face, path, options, onLog);
    }

    return options.gateway.handleRequest(request);
  };
}

async function forwardWithResolvedRoute(
  request: Request,
  face: "responses" | "messages",
  path: string,
  options: EcoSdkBridgeOptions,
  onLog: BridgeLogFn,
): Promise<Response> {
  const bodyText = await request.text();
  let body: Record<string, unknown> = {};
  if (bodyText.trim()) {
    try {
      body = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return Response.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
    }
  }

  const model = typeof body.model === "string" ? body.model : undefined;
  const headers = new Headers(request.headers);
  let clientModel = model?.trim();

  // Explicit product binding (title/auxiliary/provider probe): wins over table/alias.
  // Claude prepare must not rewrite these requests either.
  const preboundProvider = headers.get(GATEWAY_PROVIDER_ID_HEADER)?.trim();
  const preboundKind = readOptionalUpstreamKind(headers.get(GATEWAY_UPSTREAM_KIND_HEADER));

  if (
    face === "messages" &&
    options.prepareClaudeMessages &&
    !preboundProvider &&
    (path === "/v1/messages" || path === "/v1/messages/count_tokens")
  ) {
    const prepared = await options.prepareClaudeMessages({
      path,
      method: request.method,
      body,
      model,
    });
    if (prepared.kind === "response") {
      return prepared.response;
    }
    if (prepared.kind === "forward") {
      clientModel = prepared.clientModel || clientModel;
      body.model = prepared.resolution.upstreamModelId;
      if (clientModel) {
        headers.set(GATEWAY_REQUESTED_MODEL_HEADER, clientModel);
      }
      headers.set(GATEWAY_PROVIDER_ID_HEADER, prepared.resolution.providerId);
      if (prepared.resolution.upstreamKind) {
        headers.set(GATEWAY_UPSTREAM_KIND_HEADER, prepared.resolution.upstreamKind);
      }
      if (prepared.threadId?.trim()) {
        headers.set(GATEWAY_THREAD_ID_HEADER, prepared.threadId.trim());
      }
      headers.delete("content-length");
      onLog(
        `bridge → gateway face=messages provider=${prepared.resolution.providerId} model=${prepared.resolution.upstreamModelId}${prepared.threadId?.trim() ? ` thread=${prepared.threadId.trim()}` : ""}`,
      );
      return options.gateway.handleRequest(
        new Request(request.url, {
          method: request.method,
          headers,
          body: JSON.stringify(body),
          duplex: "half",
        } as RequestInit),
      );
    }
  }

  let resolution: BridgeRouteResolution | undefined;

  // Header-bound provider is final for that request: do not let model-table / eco-alias
  // steal traffic when the same model id appears on multiple providers (title/aux bug class).
  if (preboundProvider && model?.trim()) {
    resolution = {
      providerId: preboundProvider,
      upstreamModelId: model.trim(),
      ...(preboundKind ? { upstreamKind: preboundKind } : {}),
    };
  } else {
    try {
      resolution =
        resolveFromCodexTurn(
          request.headers,
          model,
          options.getTurnRouteRegistry?.() ?? options.turnRouteRegistry,
        ) ??
        resolveFromEcoAlias(model) ??
        resolveFromProviderTable(model, options.getProviders?.()) ??
        options.resolveRoute?.({ face, model, headers: request.headers });
    } catch (error) {
      if (error instanceof InvalidCodexGatewayModelAliasError) {
        onLog(`bridge invalid model alias face=${face} model=${model ?? "(missing)"}`);
        return Response.json(
          {
            error: {
              message: `Invalid gateway route alias for model '${model}': ${error.message}`,
            },
          },
          { status: 400 },
        );
      }
      throw error;
    }
  }

  if (!resolution) {
    onLog(
      `bridge route miss face=${face} model=${model ?? "(missing)"} — refusing to guess`,
    );
    return Response.json(
      {
        error: {
          message:
            "Bridge could not resolve provider for request. Register turn/agent route before calling.",
        },
      },
      { status: 400 },
    );
  }

  if (clientModel) {
    headers.set(GATEWAY_REQUESTED_MODEL_HEADER, clientModel);
  }
  body.model = resolution.upstreamModelId;
  headers.set(GATEWAY_PROVIDER_ID_HEADER, resolution.providerId);
  if (resolution.upstreamKind) {
    headers.set(GATEWAY_UPSTREAM_KIND_HEADER, resolution.upstreamKind);
  }
  // Avoid confusing gateway with partial client content-length after rewrite.
  headers.delete("content-length");

  const rewritten = new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(body),
    duplex: "half",
  } as RequestInit);

  onLog(
    `bridge → gateway face=${face} provider=${resolution.providerId} model=${resolution.upstreamModelId}`,
  );
  return options.gateway.handleRequest(rewritten);
}

function readOptionalUpstreamKind(raw: string | null | undefined): UpstreamKind | undefined {
  const value = raw?.trim();
  if (
    value === "anthropic-messages" ||
    value === "responses" ||
    value === "openai-chat" ||
    value === "gateway-delegated"
  ) {
    return value;
  }
  return undefined;
}

function resolveFromCodexTurn(
  headers: Headers,
  model: string | undefined,
  registry: CodexTurnRouteRegistry | undefined,
): BridgeRouteResolution | undefined {
  if (!registry) {
    return undefined;
  }
  const meta = parseCodexTurnMetadataHeader(headers);
  if (!meta?.threadId || !meta.turnId) {
    return undefined;
  }
  const record = registry.peek(meta.threadId, meta.turnId);
  if (!record) {
    return undefined;
  }
  return {
    providerId: record.providerId,
    upstreamModelId: record.upstreamModelId || model?.trim() || "",
    ...(record.apiCompat
      ? { upstreamKind: mapApiCompatToUpstreamKind(record.apiCompat) }
      : {}),
  };
}

/**
 * Product-layer parsing of legacy eco model aliases.
 * Gateway itself never parses these; Bridge still accepts them so hard-cut
 * can proceed without simultaneous full SDK config rewrite in every call site.
 */
function resolveFromEcoAlias(model: string | undefined): BridgeRouteResolution | undefined {
  if (!model?.trim()) {
    return undefined;
  }
  try {
    const parsed = parseCodexGatewayModelAlias(model);
    if (!parsed) {
      return undefined;
    }
    return {
      providerId: parsed.providerId,
      upstreamModelId: parsed.upstreamModelId,
      ...(parsed.apiCompat
        ? { upstreamKind: mapApiCompatToUpstreamKind(parsed.apiCompat) }
        : {}),
    };
  } catch (error) {
    if (error instanceof InvalidCodexGatewayModelAliasError) {
      // Malformed reserved V1 alias — fail closed with explicit error at caller.
      throw error;
    }
    throw error;
  }
}

/**
 * Product-only: eco_{providerId} → default upstream model; models[] exact match.
 * Gateway never does this.
 */
function resolveFromProviderTable(
  model: string | undefined,
  providers:
    | readonly { id: string; upstreamModelId: string; models: string[] }[]
    | undefined,
): BridgeRouteResolution | undefined {
  if (!model?.trim() || !providers?.length) {
    return undefined;
  }
  const requested = model.trim();
  const ecoMatch = providers.find((p) => requested === `eco_${p.id}`);
  if (ecoMatch) {
    return {
      providerId: ecoMatch.id,
      upstreamModelId: ecoMatch.upstreamModelId,
    };
  }
  const exact = providers.find((p) => p.models.includes(requested));
  if (exact) {
    return {
      providerId: exact.id,
      upstreamModelId: requested,
    };
  }
  return undefined;
}

export async function startEcoSdkBridge(
  host: string,
  port: number,
  options: EcoSdkBridgeOptions,
): Promise<EcoSdkBridgeServer> {
  const handleRequest = createEcoSdkBridgeHandler(options);
  const server = http.createServer((req, res) => {
    void dispatchNodeRequest(req as IncomingMessage, res as ServerResponse, handleRequest).catch(
      (error) => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: {
                message: error instanceof Error ? error.message : String(error),
              },
            }),
          );
        } else {
          res.destroy(error instanceof Error ? error : undefined);
        }
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  const address = server.address();
  const boundPort =
    address && typeof address === "object" && typeof address.port === "number"
      ? address.port
      : port;

  return {
    port: boundPort,
    baseUrl: `http://127.0.0.1:${boundPort}`,
    stop: () => {
      server.close();
    },
    handleRequest,
  };
}

export { CODEX_TURN_METADATA_HEADER };
