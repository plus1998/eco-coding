import {
  normalizeCodexIntegerToolSchemas,
  type ResponsesRequest,
  type ResponsesUsage,
} from "@eco/openai-anthropic-bridge";
import {
  CODEX_TURN_METADATA_HEADER,
  parseCodexTurnMetadataHeader,
} from "../codex-turn-metadata.js";
import {
  InvalidProviderRouteAliasError,
  ProviderNotFoundError,
  buildUpstreamCompactUrl,
  buildUpstreamUrl,
  resolveProviderRoute,
} from "../provider-router.js";
import type { GatewayLogFn } from "../server.js";
import {
  codexToolArgumentFailureCircuitBreaker,
  normalizeResponsesToolArgumentResponse,
  toolArgumentCircuitBreakResponse,
} from "../tool-argument-guard.js";
import type {
  GatewayCodexTurnMetadata,
  GatewayConfig,
  GatewayUsageEvent,
  GatewayUsageObserver,
  ResolvedProviderRoute,
} from "../types.js";
import { forwardAnthropicMessages } from "../upstream/anthropic-messages.js";
import { forwardOpenAIChat } from "../upstream/openai-chat.js";
import { forwardResponsesPassthrough } from "../upstream/responses-passthrough.js";
import { upstreamErrorResponse } from "../upstream/upstream-error.js";
import { applyUpstreamUserAgent } from "../upstream/user-agent.js";
import { normalizeResponsesUsage } from "../usage-normalize.js";

let compactUsageEventSeq = 0;

export async function handlePostResponses(
  request: Request,
  config: GatewayConfig,
  fetchImpl: typeof fetch = fetch,
  onLog: GatewayLogFn = () => undefined,
  onUsage?: GatewayUsageObserver,
): Promise<Response> {
  let body: ResponsesRequest;
  try {
    body = (await request.json()) as ResponsesRequest;
  } catch {
    onLog("POST /v1/responses rejected: invalid JSON body");
    return Response.json(
      { error: { message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const requestedModel =
    typeof body.model === "string" ? body.model.trim() : "(missing model)";
  const codexTurnMetadata = parseCodexTurnMetadataHeader(request.headers);
  if (request.headers.has(CODEX_TURN_METADATA_HEADER) && !codexTurnMetadata) {
    onLog(
      `POST /v1/responses received invalid ${CODEX_TURN_METADATA_HEADER}; usage will not be billed`,
    );
  }
  onLog(
    `POST /v1/responses model=${requestedModel} stream=${body.stream === true} providers=${config.providers.map((p) => p.id).join(",")}`,
  );

  const failureObservation = codexToolArgumentFailureCircuitBreaker.observe({
    ...(codexTurnMetadata?.threadId
      ? { threadId: codexTurnMetadata.threadId }
      : {}),
    ...(codexTurnMetadata?.turnId ? { turnId: codexTurnMetadata.turnId } : {}),
    responsesInput: body.input,
  });
  if (failureObservation?.tripped) {
    onLog(
      `tool argument parse loop stopped thread=${codexTurnMetadata?.threadId ?? "(unknown)"} ` +
        `turn=${codexTurnMetadata?.turnId ?? "(unknown)"} count=${failureObservation.count}`,
    );
    return toolArgumentCircuitBreakResponse(
      body.stream === true,
      failureObservation.count,
    );
  }
  body = normalizeCodexIntegerToolSchemas(body);

  let route: ResolvedProviderRoute;
  try {
    route = resolveProviderRoute(body.model, config.providers);
  } catch (error) {
    if (
      error instanceof ProviderNotFoundError ||
      error instanceof InvalidProviderRouteAliasError
    ) {
      onLog(`route miss for model=${requestedModel}: ${error.message}`);
      return Response.json(
        { error: { message: error.message } },
        { status: error.status },
      );
    }
    throw error;
  }

  if (
    hasCompactionTrigger(body.input) &&
    (route.upstreamKind === "openai-chat" ||
      route.upstreamKind === "anthropic-messages")
  ) {
    onLog(
      `responses compaction trigger unsupported provider=${route.provider.id} kind=${route.upstreamKind}`,
    );
    return unsupportedCompactionResponse(
      route,
      `uses ${route.upstreamKind} and does not support Responses compaction triggers.`,
    );
  }

  const upstreamUrl = buildUpstreamUrl(route.provider, route.upstreamKind);
  onLog(
    `route hit provider=${route.provider.id} kind=${route.upstreamKind} upstreamModel=${route.upstreamModelId} → ${upstreamUrl}`,
  );

  let upstreamResponse: Response;
  switch (route.upstreamKind) {
    case "anthropic-messages":
      upstreamResponse = await forwardAnthropicMessages(
        route,
        body,
        request.headers,
        fetchImpl,
        onLog,
        onUsage,
        codexTurnMetadata,
        config.upstreamUserAgent,
      );
      break;
    case "responses":
    case "gateway-delegated":
      upstreamResponse = await forwardResponsesPassthrough(
        route,
        body,
        request.headers,
        fetchImpl,
        onLog,
        onUsage,
        codexTurnMetadata,
        config.upstreamUserAgent,
      );
      break;
    case "openai-chat":
      upstreamResponse = await forwardOpenAIChat(
        route,
        body,
        request.headers,
        fetchImpl,
        onLog,
        onUsage,
        codexTurnMetadata,
        config.upstreamUserAgent,
      );
      break;
    default: {
      const _exhaustive: never = route.upstreamKind;
      return _exhaustive;
    }
  }
  return normalizeResponsesToolArgumentResponse(upstreamResponse);
}

/**
 * Codex CLI `POST /v1/responses/compact` (and `/responses/compact`).
 *
 * Every successful response is validated; provider capability gaps stay explicit.
 */
export async function handlePostResponsesCompact(
  request: Request,
  config: GatewayConfig,
  fetchImpl: typeof fetch = fetch,
  onLog: GatewayLogFn = () => undefined,
  onUsage?: GatewayUsageObserver,
): Promise<Response> {
  let body: ResponsesRequest;
  try {
    body = (await request.json()) as ResponsesRequest;
  } catch {
    onLog("POST /v1/responses/compact rejected: invalid JSON body");
    return Response.json(
      { error: { message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const requestedModel =
    typeof body.model === "string" ? body.model.trim() : "(missing model)";
  const parsedCodexTurnMetadata = parseCodexTurnMetadataHeader(request.headers);
  const codexTurnMetadata =
    parsedCodexTurnMetadata?.requestKind === "compaction"
      ? parsedCodexTurnMetadata
      : undefined;
  if (
    request.headers.has(CODEX_TURN_METADATA_HEADER) &&
    !parsedCodexTurnMetadata
  ) {
    onLog(
      `POST /v1/responses/compact received invalid ${CODEX_TURN_METADATA_HEADER}; usage will not be billed`,
    );
  } else if (parsedCodexTurnMetadata && !codexTurnMetadata) {
    onLog(
      `POST /v1/responses/compact received request_kind=${parsedCodexTurnMetadata.requestKind}; expected compaction, usage will not be billed`,
    );
  }
  onLog(
    `POST /v1/responses/compact model=${requestedModel} stream=${body.stream === true}`,
  );

  let route: ResolvedProviderRoute;
  try {
    route = resolveProviderRoute(body.model, config.providers);
  } catch (error) {
    if (
      error instanceof ProviderNotFoundError ||
      error instanceof InvalidProviderRouteAliasError
    ) {
      onLog(`route miss for model=${requestedModel}: ${error.message}`);
      return Response.json(
        { error: { message: error.message } },
        { status: error.status },
      );
    }
    throw error;
  }

  switch (route.upstreamKind) {
    case "openai-chat":
      onLog(
        `compact unsupported provider=${route.provider.id} kind=openai-chat`,
      );
      return unsupportedCompactionResponse(
        route,
        "uses OpenAI Chat and does not support the Responses compact endpoint.",
      );
    case "responses":
    case "gateway-delegated": {
      const upstreamUrl = buildUpstreamCompactUrl(route.provider);
      onLog(`compact route provider=${route.provider.id} → ${upstreamUrl}`);
      const upstreamHeaders: Record<string, string> = {
        "content-type": "application/json",
        authorization: `Bearer ${route.provider.apiKey}`,
      };
      applyUpstreamUserAgent(
        upstreamHeaders,
        request.headers,
        config.upstreamUserAgent,
      );
      try {
        const upstreamResponse = await fetchImpl(upstreamUrl, {
          method: "POST",
          headers: upstreamHeaders,
          body: JSON.stringify({ ...body, model: route.upstreamModelId }),
        });
        return await validateNativeCompactResponse(
          upstreamResponse,
          route,
          upstreamUrl,
          onLog,
          onUsage,
          codexTurnMetadata,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onLog(`compact upstream failed ${upstreamUrl}: ${message}`);
        return upstreamErrorResponse({
          route,
          upstreamUrl,
          status: 502,
          bodyText: `compact request failed: ${message}`,
        });
      }
    }
    case "anthropic-messages":
      onLog(
        `compact unsupported provider=${route.provider.id} kind=anthropic-messages`,
      );
      return unsupportedCompactionResponse(
        route,
        "uses Anthropic Messages and does not support the Responses compact endpoint.",
      );
    default: {
      const _exhaustive: never = route.upstreamKind;
      return _exhaustive;
    }
  }
}

async function validateNativeCompactResponse(
  response: Response,
  route: ResolvedProviderRoute,
  upstreamUrl: string,
  onLog: GatewayLogFn,
  onUsage?: GatewayUsageObserver,
  codexTurnMetadata?: GatewayCodexTurnMetadata,
): Promise<Response> {
  const text = await response.text();
  if (!response.ok) {
    onLog(
      `compact upstream error status=${response.status} body=${text.slice(0, 300)}`,
    );
    return upstreamErrorResponse({
      route,
      upstreamUrl,
      status: response.status,
      bodyText: text,
    });
  }

  const validationError = validateCompactJson(text);
  if (validationError) {
    onLog(`compact upstream invalid response: ${validationError}`);
    return invalidCompactResponse(route, upstreamUrl, validationError);
  }
  if (onUsage && codexTurnMetadata) {
    observeNativeCompactUsage({
      text,
      responseHeaders: response.headers,
      route,
      codexTurnMetadata,
      onUsage,
      onLog,
    });
  }
  return recreateResponse(response, text);
}

function observeNativeCompactUsage(input: {
  text: string;
  responseHeaders: Headers;
  route: ResolvedProviderRoute;
  codexTurnMetadata: GatewayCodexTurnMetadata;
  onUsage: GatewayUsageObserver;
  onLog: GatewayLogFn;
}): void {
  const response = JSON.parse(input.text) as Record<string, unknown>;
  const responseModel =
    readString(response, "model") ?? input.route.upstreamModelId;
  const usage = normalizeResponsesUsage(
    isRecord(response.usage)
      ? (response.usage as unknown as ResponsesUsage)
      : undefined,
    responseModel,
  );
  if (!usage) {
    input.onLog(
      "compact upstream response has no valid usage; usage will not be billed",
    );
    return;
  }

  const responseId = readString(response, "id");
  const providerRequestId = readProviderRequestId(input.responseHeaders);
  const event: GatewayUsageEvent = {
    source: "responses",
    sourceEventId: buildCompactUsageSourceEventId({
      route: input.route,
      ...(responseId && { responseId }),
      ...(providerRequestId && { providerRequestId }),
    }),
    providerId: input.route.provider.id,
    requestedModel: input.route.requestedModel,
    upstreamModelId: input.route.upstreamModelId,
    usage,
    stream: false,
    observedAt: new Date().toISOString(),
    ...(responseId && { responseId }),
    ...(providerRequestId && { providerRequestId }),
    codexTurnMetadata: input.codexTurnMetadata,
  };
  try {
    void Promise.resolve(input.onUsage(event)).catch((error) => {
      input.onLog(`usage observer failed: ${errorMessage(error)}`);
    });
  } catch (error) {
    input.onLog(`usage observer failed: ${errorMessage(error)}`);
  }
}

function buildCompactUsageSourceEventId(input: {
  route: ResolvedProviderRoute;
  responseId?: string;
  providerRequestId?: string;
}): string {
  if (input.responseId) {
    return `responses:${input.route.provider.id}:response:${input.responseId}`;
  }
  if (input.providerRequestId) {
    return `responses:${input.route.provider.id}:request:${input.providerRequestId}`;
  }
  compactUsageEventSeq += 1;
  return [
    "responses",
    input.route.provider.id,
    input.route.requestedModel,
    "compaction",
    Date.now(),
    compactUsageEventSeq,
  ].join(":");
}

function readProviderRequestId(headers: Headers): string | undefined {
  return (
    headers.get("x-request-id")?.trim() ||
    headers.get("request-id")?.trim() ||
    headers.get("openai-request-id")?.trim() ||
    undefined
  );
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateCompactJson(text: string): string | undefined {
  if (!text.trim()) {
    return "upstream returned an empty compact response body";
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "upstream compact response is not valid JSON";
  }
  if (!isRecord(parsed)) {
    return "upstream compact response root is not an object";
  }
  if (!Array.isArray(parsed.output) || parsed.output.length === 0) {
    return "upstream compact response output is missing or empty";
  }
  if (
    parsed.output.some(
      (item) =>
        !isRecord(item) || typeof item.type !== "string" || !item.type.trim(),
    )
  ) {
    return "upstream compact response contains an invalid output item";
  }
  const compactionItems = parsed.output.filter(
    (item): item is Record<string, unknown> =>
      isRecord(item) && item.type === "compaction",
  );
  if (compactionItems.length !== 1) {
    return "upstream compact response output must contain exactly one compaction item";
  }
  const encryptedContent = compactionItems[0]?.encrypted_content;
  if (
    typeof encryptedContent !== "string" ||
    encryptedContent.trim().length === 0
  ) {
    return "upstream compact response compaction item encrypted_content is missing or empty";
  }
  return undefined;
}

function hasCompactionTrigger(input: unknown): boolean {
  let parsedInput = input;
  if (typeof parsedInput === "string") {
    try {
      parsedInput = JSON.parse(parsedInput) as unknown;
    } catch {
      return false;
    }
  }
  return (
    Array.isArray(parsedInput) &&
    parsedInput.some(
      (item) => isRecord(item) && item.type === "compaction_trigger",
    )
  );
}

function unsupportedCompactionResponse(
  route: ResolvedProviderRoute,
  reason: string,
): Response {
  return Response.json(
    {
      error: {
        message: `Provider ${route.provider.id} ${reason}`,
        type: "unsupported_error",
        providerId: route.provider.id,
        model: route.upstreamModelId,
      },
    },
    { status: 501 },
  );
}

function invalidCompactResponse(
  route: ResolvedProviderRoute,
  upstreamUrl: string,
  detail: string,
): Response {
  return upstreamErrorResponse({
    route,
    upstreamUrl,
    status: 502,
    bodyText: detail,
  });
}

function recreateResponse(source: Response, text: string): Response {
  const headers = new Headers(source.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(text, {
    status: source.status,
    statusText: source.statusText,
    headers,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function handleHealth(config: GatewayConfig): Response {
  return Response.json({
    ok: true,
    service: "eco-gateway",
    providers: config.providers.map((provider) => ({
      id: provider.id,
      upstreamKind: provider.upstreamKind,
      models: provider.models,
    })),
  });
}
