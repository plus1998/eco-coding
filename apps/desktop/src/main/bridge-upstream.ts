import http from "node:http";
import {
  anthropicEventToResponsesEvents,
  anthropicToResponses,
  chatCompletionsChunkToResponsesEvents,
  chatCompletionsResponseToResponses,
  extractAnthropicRequestToolNames,
  finalizeAnthropicResponsesStream,
  finalizeChatCompletionsResponsesStream,
  finalizeResponsesAnthropicStream,
  newAnthropicEventToResponsesState,
  newChatCompletionsToResponsesStreamState,
  newResponsesEventToAnthropicState,
  checkAnthropicStreamEvent,
  newAnthropicStreamSequenceState,
  responsesAnthropicEventToSse,
  responsesEventToAnthropicEvents,
  responsesToAnthropic,
  responsesToChatCompletionsRequest,
  type AnthropicRequest,
  type AnthropicResponse,
  type AnthropicStreamEvent,
  type ChatCompletionsChunk,
  type ChatCompletionsResponse,
  type ResponsesResponse,
  type ResponsesStreamEvent,
} from "@eco/openai-anthropic-bridge";
import type { AgentRole } from "../shared/ipc";
import type { UpstreamApiCompat } from "../shared/api-compat";
import {
  anthropicResponseToStreamEvents,
  writeAnthropicStreamEvents,
} from "./anthropic-stream-replay";
import {
  buildChatCompletionsUrl,
  buildOpenAICompatUpstreamUrl,
  buildProviderRequestBaseUrl,
} from "./provider-models";
import { buildProxyUpstreamHeaders } from "./upstream-request-headers";
import type { ProviderConfigSecret } from "./provider-store";
import {
  createStreamingUsageTracker,
  extractUsageFromResponseBody,
} from "./anthropic-usage";
import type { ParsedUsage } from "@eco/runtime";
import {
  buildProxyCallDebug,
  isUpstreamLogVerbose,
  logUpstreamProxyCall,
  proxyCallCommonFields,
  resolveProxyCallBilling,
  tokensFromUsage,
  type UpstreamProxyCallBilling,
} from "./upstream-proxy-log";
import {
  headersToLoggable,
  logUpstream,
  logUpstreamError,
  parseJsonForLog,
  formatUpstreamFetchError,
} from "./upstream-log";

export interface BridgeForwardRoute {
  role: string;
  provider: ProviderConfigSecret;
  modelId: string;
  apiCompat: UpstreamApiCompat;
  aliasModelId: string;
}

export interface BridgeForwardContext {
  route: BridgeForwardRoute;
  body: Record<string, unknown>;
  requestedModel?: string;
  requestUrl?: string;
  upstreamUserAgent?: string;
  onUsage?: BridgeUsageHandler;
}

export interface BridgeUsageInfo {
  role: AgentRole;
  providerId: string;
  providerName: string;
  providerBaseUrl: string;
  modelId: string;
  requestedModel?: string;
  requestId?: string;
  usage: ParsedUsage;
}

export type BridgeUsageHandler = (
  info: BridgeUsageInfo,
) => void | Promise<UpstreamProxyCallBilling | null | undefined>;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildBridgeUpstreamHeaders(
  request: http.IncomingMessage,
  route: BridgeForwardRoute,
  upstreamUserAgent?: string,
): Record<string, string> {
  return buildProxyUpstreamHeaders({
    clientHeaders: request.headers,
    apiKey: route.provider.apiKey,
    apiCompat: route.apiCompat,
    ...(upstreamUserAgent ? { upstreamUserAgent } : {}),
  });
}

function buildBridgeUsageInfo(
  route: BridgeForwardRoute,
  usage: ParsedUsage,
  requestedModel?: string,
  requestId?: string,
): BridgeUsageInfo {
  return {
    role: route.role as AgentRole,
    providerId: route.provider.id,
    providerName: route.provider.name,
    providerBaseUrl: route.provider.baseUrl,
    modelId: route.modelId,
    ...(requestedModel && { requestedModel }),
    ...(requestId && { requestId }),
    usage,
  };
}

function bridgeProxyCallCommonFields(input: {
  route: BridgeForwardRoute;
  requestedModel: string | undefined;
  requestUrl: string | undefined;
  upstreamUrl: string;
  stream: boolean;
  converted: boolean;
}) {
  return proxyCallCommonFields({
    role: input.route.role,
    provider: input.route.provider,
    apiCompat: input.route.apiCompat,
    modelId: input.route.modelId,
    aliasModelId: input.route.aliasModelId,
    ...(input.requestedModel && { requestedModel: input.requestedModel }),
    ...(input.requestUrl && { requestUrl: input.requestUrl }),
    upstreamUrl: input.upstreamUrl,
    stream: input.stream,
    converted: input.converted,
  });
}

function bridgeProxyDebugField(input: {
  converted: boolean;
  clientRequestRaw: string;
  upstreamRequestRaw: string;
  responseRaw?: string;
}): { debug: NonNullable<ReturnType<typeof buildProxyCallDebug>> } | Record<string, never> {
  const debug = buildProxyCallDebug({
    converted: input.converted,
    clientRequestRaw: input.clientRequestRaw,
    upstreamRequestRaw: input.upstreamRequestRaw,
    ...(input.responseRaw !== undefined && { responseRaw: input.responseRaw }),
  });
  return debug ? { debug } : {};
}

function bridgeFetchInit(
  request: http.IncomingMessage,
  headers: Record<string, string>,
  body: string,
): RequestInit {
  const signal = (request as http.IncomingMessage & { signal?: AbortSignal }).signal;
  return {
    method: "POST",
    headers,
    body,
    ...(signal && { signal }),
  };
}

/** Anthropic apiCompat: substitute routed model only (no Responses IR). */
export function buildAnthropicPassthroughPayload(
  body: Record<string, unknown>,
  modelId: string,
): Record<string, unknown> {
  return { ...body, model: modelId };
}

/** Responses IR → upstream wire format (OpenAI-compat apiCompat only). */
export function buildBridgeUpstreamMessagesPayload(
  apiCompat: UpstreamApiCompat,
  anthropicRequest: AnthropicRequest,
  modelId: string,
  stream: boolean,
): Record<string, unknown> {
  if (apiCompat === "anthropic") {
    return buildAnthropicPassthroughPayload(
      anthropicRequest as unknown as Record<string, unknown>,
      modelId,
    );
  }

  const responsesReq = anthropicToResponses(anthropicRequest);
  responsesReq.model = modelId;
  responsesReq.stream = stream;

  if (apiCompat === "openai_responses") {
    return responsesReq as unknown as Record<string, unknown>;
  }

  const chatReq = responsesToChatCompletionsRequest(responsesReq);
  chatReq.model = modelId;
  chatReq.stream = stream;
  return chatReq as unknown as Record<string, unknown>;
}

export function resolveBridgeUpstreamUrl(
  apiCompat: UpstreamApiCompat,
  baseUrl: string,
  requestPath: string,
  clientRequestUrl?: string,
): string {
  if (apiCompat === "openai_chat_completions") {
    return buildChatCompletionsUrl(baseUrl, requestPath);
  }
  if (apiCompat === "openai_responses") {
    return buildOpenAICompatUpstreamUrl(baseUrl, requestPath);
  }

  const root = buildProviderRequestBaseUrl(baseUrl, requestPath);
  const path = clientRequestUrl?.split("?")[0] ?? "/v1/messages";
  return `${trimTrailingSlash(root)}${path.startsWith("/") ? path : `/${path}`}`;
}

export function splitSseBlocks(buffer: string): { blocks: string[]; remainder: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const remainder = parts.pop() ?? "";
  return { blocks: parts.filter((block) => block.trim()), remainder };
}

export function parseResponsesStreamEventBlock(block: string): ResponsesStreamEvent | null {
  let eventType = "";
  const dataLines: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      eventType = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  const data = dataLines.join("\n").trim();
  if (!data || data === "[DONE]") {
    return null;
  }

  try {
    const parsed = JSON.parse(data) as ResponsesStreamEvent & { type?: string };
    if (!parsed.type && eventType) {
      parsed.type = eventType as ResponsesStreamEvent["type"];
    }
    return parsed;
  } catch {
    return null;
  }
}

export function parseAnthropicStreamEventBlock(block: string): AnthropicStreamEvent | null {
  let eventType = "";
  const dataLines: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      eventType = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  const data = dataLines.join("\n").trim();
  if (!data || data === "[DONE]") {
    return null;
  }

  try {
    const parsed = JSON.parse(data) as AnthropicStreamEvent & { type?: string };
    if (!parsed.type && eventType) {
      parsed.type = eventType as AnthropicStreamEvent["type"];
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseChatCompletionsChunkBlock(block: string): ChatCompletionsChunk | null {
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  const data = dataLines.join("\n").trim();
  if (!data || data === "[DONE]") {
    return null;
  }
  try {
    return JSON.parse(data) as ChatCompletionsChunk;
  } catch {
    return null;
  }
}

function parseBufferedOpenAIMessage(
  responseText: string,
  apiCompat: UpstreamApiCompat,
  modelId: string,
  requestBody?: AnthropicRequest,
): AnthropicResponse {
  const toolNames = requestBody ? extractAnthropicRequestToolNames(requestBody) : [];
  const parsed = JSON.parse(responseText) as Record<string, unknown>;
  if (parsed.type === "message" && Array.isArray(parsed.content)) {
    return parsed as unknown as AnthropicResponse;
  }
  if (apiCompat === "openai_chat_completions" && Array.isArray(parsed.choices)) {
    return responsesToAnthropic(
      chatCompletionsResponseToResponses(parsed as unknown as ChatCompletionsResponse, modelId),
      modelId,
      toolNames,
    );
  }
  return responsesToAnthropic(parsed as unknown as ResponsesResponse, modelId, toolNames);
}

function parseBufferedAnthropicUpstreamMessage(responseText: string): AnthropicResponse {
  const parsed = JSON.parse(responseText) as Record<string, unknown>;
  if (parsed.type !== "message" || !Array.isArray(parsed.content)) {
    throw new Error("not anthropic message");
  }
  return parsed as unknown as AnthropicResponse;
}

function writeBufferedAnthropicToClient(
  response: http.ServerResponse,
  stream: boolean,
  anthropicMessage: AnthropicResponse,
): void {
  if (stream) {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    writeAnthropicStreamEvents(response, anthropicResponseToStreamEvents(anthropicMessage));
    response.end();
    return;
  }

  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(anthropicMessage));
}

export async function forwardMessagesViaBridge(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  ctx: BridgeForwardContext,
): Promise<void> {
  if (ctx.route.apiCompat === "anthropic") {
    return forwardAnthropicNativeMessages(request, response, ctx);
  }
  if (ctx.route.apiCompat === "openai_chat_completions") {
    return forwardOpenAIChatCompletionsMessages(request, response, ctx);
  }
  return forwardOpenAIResponsesMessages(request, response, ctx);
}

async function forwardAnthropicNativeMessages(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  ctx: BridgeForwardContext,
): Promise<void> {
  const { route, body, requestedModel, onUsage, requestUrl } = ctx;
  const startedAt = Date.now();
  const anthropicRequest = body as unknown as AnthropicRequest;
  const stream = body.stream === true;
  const upstreamUrl = resolveBridgeUpstreamUrl(
    route.apiCompat,
    route.provider.baseUrl,
    route.provider.requestPath,
    requestUrl,
  );
  const upstreamBody = buildBridgeUpstreamMessagesPayload(
    route.apiCompat,
    anthropicRequest,
    route.modelId,
    stream,
  );
  const requestPayload = JSON.stringify(upstreamBody);
  const anthropicRequestPayload = JSON.stringify(body);
  const upstreamHeaders = buildBridgeUpstreamHeaders(request, route, ctx.upstreamUserAgent);
  const callCommon = () =>
    bridgeProxyCallCommonFields({
      route,
      requestedModel,
      requestUrl,
      upstreamUrl,
      stream,
      converted: false,
    });
  const failureDebug = (responseRaw?: string) =>
    bridgeProxyDebugField({
      converted: false,
      clientRequestRaw: anthropicRequestPayload,
      upstreamRequestRaw: requestPayload,
      ...(responseRaw !== undefined && { responseRaw }),
    });

  if (isUpstreamLogVerbose()) {
    logUpstream("anthropic-messages-request", {
      url: upstreamUrl,
      headers: headersToLoggable(upstreamHeaders),
      body: parseJsonForLog(requestPayload),
    });
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, bridgeFetchInit(request, upstreamHeaders, requestPayload));
  } catch (error) {
    const message = formatUpstreamFetchError(error);
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: false,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: 0, streaming: stream },
      error: message,
      ...failureDebug(),
    });
    throw error;
  }

  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const isEventStream = contentType.includes("text/event-stream");
  const requestId =
    upstreamResponse.headers.get("x-request-id") ??
    upstreamResponse.headers.get("request-id") ??
    undefined;

  if (!upstreamResponse.ok) {
    const responseText = await upstreamResponse.text();
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: false,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: upstreamResponse.status, streaming: stream },
      error: upstreamResponse.statusText || String(upstreamResponse.status),
      ...failureDebug(responseText),
    });
    response.writeHead(upstreamResponse.status, {
      "content-type": contentType || "application/json",
    });
    response.end(responseText);
    return;
  }

  if (!isEventStream) {
    const responseText = await upstreamResponse.text();
    let usage: ParsedUsage | null = null;
    try {
      usage = extractUsageFromResponseBody(JSON.parse(responseText));
    } catch {
      usage = null;
    }
    const billing = usage
      ? await resolveProxyCallBilling(onUsage, buildBridgeUsageInfo(route, usage, requestedModel, requestId))
      : null;
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: true,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: upstreamResponse.status, streaming: stream },
      ...(usage && { tokens: tokensFromUsage(usage) }),
      billing,
    });

    response.writeHead(200, { "content-type": contentType || "application/json" });
    response.end(responseText);
    return;
  }

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const usageTracker = createStreamingUsageTracker();

  try {
    if (!upstreamResponse.body) {
      response.end();
      return;
    }

    for await (const chunk of upstreamResponse.body as unknown as AsyncIterable<Uint8Array>) {
      const bytes = Buffer.from(chunk);
      usageTracker.push(bytes);
      response.write(bytes);
    }

    const usage = usageTracker.finish();
    const billing = usage
      ? await resolveProxyCallBilling(onUsage, buildBridgeUsageInfo(route, usage, requestedModel, requestId))
      : null;
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: true,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: upstreamResponse.status, streaming: stream },
      ...(usage && { tokens: tokensFromUsage(usage) }),
      billing,
    });
  } catch (error) {
    const message = formatUpstreamFetchError(error);
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: false,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: upstreamResponse.status, streaming: stream },
      error: message,
      ...failureDebug(),
    });
  } finally {
    if (!response.writableEnded) {
      response.end();
    }
  }
}

async function forwardOpenAIResponsesMessages(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  ctx: BridgeForwardContext,
): Promise<void> {
  const { route, body, requestedModel, onUsage, requestUrl } = ctx;
  const startedAt = Date.now();
  const anthropicRequest = body as unknown as AnthropicRequest;
  const requestToolNames = extractAnthropicRequestToolNames(anthropicRequest);
  const stream = body.stream === true;
  const upstreamUrl = resolveBridgeUpstreamUrl(
    route.apiCompat,
    route.provider.baseUrl,
    route.provider.requestPath,
    requestUrl,
  );
  const upstreamBody = buildBridgeUpstreamMessagesPayload(
    route.apiCompat,
    anthropicRequest,
    route.modelId,
    stream,
  );
  const requestPayload = JSON.stringify(upstreamBody);
  const upstreamHeaders = buildBridgeUpstreamHeaders(request, route, ctx.upstreamUserAgent);
  const anthropicRequestPayload = JSON.stringify(body);
  const callCommon = () =>
    bridgeProxyCallCommonFields({
      route,
      requestedModel,
      requestUrl,
      upstreamUrl,
      stream,
      converted: true,
    });
  const failureDebug = (responseRaw?: string) =>
    bridgeProxyDebugField({
      converted: true,
      clientRequestRaw: anthropicRequestPayload,
      upstreamRequestRaw: requestPayload,
      ...(responseRaw !== undefined && { responseRaw }),
    });

  if (isUpstreamLogVerbose()) {
    logUpstream("openai-responses-request", {
      url: upstreamUrl,
      headers: headersToLoggable(upstreamHeaders),
      body: parseJsonForLog(requestPayload),
    });
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, bridgeFetchInit(request, upstreamHeaders, requestPayload));
  } catch (error) {
    const message = formatUpstreamFetchError(error);
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: false,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: 0, streaming: stream },
      error: message,
      ...failureDebug(),
    });
    throw error;
  }

  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const isEventStream = contentType.includes("text/event-stream");

  if (!upstreamResponse.ok) {
    const responseText = await upstreamResponse.text();
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: false,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: upstreamResponse.status, streaming: stream },
      error: upstreamResponse.statusText || String(upstreamResponse.status),
      ...failureDebug(responseText),
    });
    response.writeHead(upstreamResponse.status, {
      "content-type": contentType || "application/json",
    });
    response.end(responseText);
    return;
  }

  if (!isEventStream) {
    const responseText = await upstreamResponse.text();
    let anthropicMessage: AnthropicResponse;
    try {
      anthropicMessage = parseBufferedOpenAIMessage(
        responseText,
        route.apiCompat,
        route.modelId,
        anthropicRequest,
      );
    } catch {
      logUpstreamProxyCall({
        at: new Date().toISOString(),
        ok: false,
        elapsedMs: Date.now() - startedAt,
        ...callCommon(),
        http: { status: upstreamResponse.status, streaming: stream },
        error: "无法解析 OpenAI Responses 上游响应。",
        ...failureDebug(responseText),
      });
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "无法解析 OpenAI Responses 上游响应。" }));
      return;
    }

    const usage = extractUsageFromResponseBody(anthropicMessage);
    const billing = usage
      ? await resolveProxyCallBilling(onUsage, buildBridgeUsageInfo(route, usage, requestedModel))
      : null;
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: true,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: upstreamResponse.status, streaming: stream },
      ...(usage && { tokens: tokensFromUsage(usage) }),
      billing,
    });
    writeBufferedAnthropicToClient(response, stream, anthropicMessage);
    return;
  }

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const anthropicState = newResponsesEventToAnthropicState(requestToolNames);
  const usageTracker = createStreamingUsageTracker();
  let sseBuffer = "";

  const writeAnthropicSse = (events: ReturnType<typeof responsesEventToAnthropicEvents>) => {
    for (const anthropicEvent of events) {
      const sse = responsesAnthropicEventToSse(anthropicEvent);
      usageTracker.push(Buffer.from(sse, "utf8"));
      response.write(sse);
    }
  };

  try {
    if (!upstreamResponse.body) {
      response.end();
      return;
    }

    for await (const chunk of upstreamResponse.body as unknown as AsyncIterable<Uint8Array>) {
      sseBuffer += Buffer.from(chunk).toString("utf8");
      const { blocks, remainder } = splitSseBlocks(sseBuffer);
      sseBuffer = remainder;
      for (const block of blocks) {
        const responsesEvent = parseResponsesStreamEventBlock(block);
        if (!responsesEvent) {
          continue;
        }
        writeAnthropicSse(responsesEventToAnthropicEvents(responsesEvent, anthropicState));
      }
    }

    if (sseBuffer.trim()) {
      const { blocks } = splitSseBlocks(`${sseBuffer}\n\n`);
      for (const block of blocks) {
        const responsesEvent = parseResponsesStreamEventBlock(block);
        if (responsesEvent) {
          writeAnthropicSse(responsesEventToAnthropicEvents(responsesEvent, anthropicState));
        }
      }
    }

    writeAnthropicSse(finalizeResponsesAnthropicStream(anthropicState));

    const usage = usageTracker.finish();
    const billing = usage
      ? await resolveProxyCallBilling(onUsage, buildBridgeUsageInfo(route, usage, requestedModel))
      : null;
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: true,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: upstreamResponse.status, streaming: stream },
      ...(usage && { tokens: tokensFromUsage(usage) }),
      billing,
    });
  } catch (error) {
    const message = formatUpstreamFetchError(error);
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: false,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: upstreamResponse.status, streaming: stream },
      error: message,
      ...failureDebug(),
    });
  } finally {
    if (!response.writableEnded) {
      response.end();
    }
  }
}

async function forwardOpenAIChatCompletionsMessages(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  ctx: BridgeForwardContext,
): Promise<void> {
  const { route, body, requestedModel, onUsage, requestUrl } = ctx;
  const startedAt = Date.now();
  const anthropicRequest = body as unknown as AnthropicRequest;
  const requestToolNames = extractAnthropicRequestToolNames(anthropicRequest);
  const stream = body.stream === true;
  const upstreamUrl = resolveBridgeUpstreamUrl(
    route.apiCompat,
    route.provider.baseUrl,
    route.provider.requestPath,
    requestUrl,
  );
  const upstreamBody = buildBridgeUpstreamMessagesPayload(
    route.apiCompat,
    anthropicRequest,
    route.modelId,
    stream,
  );
  const requestPayload = JSON.stringify(upstreamBody);
  const upstreamHeaders = buildBridgeUpstreamHeaders(request, route, ctx.upstreamUserAgent);
  const anthropicRequestPayload = JSON.stringify(body);
  const callCommon = () =>
    bridgeProxyCallCommonFields({
      route,
      requestedModel,
      requestUrl,
      upstreamUrl,
      stream,
      converted: true,
    });
  const failureDebug = (responseRaw?: string) =>
    bridgeProxyDebugField({
      converted: true,
      clientRequestRaw: anthropicRequestPayload,
      upstreamRequestRaw: requestPayload,
      ...(responseRaw !== undefined && { responseRaw }),
    });

  if (isUpstreamLogVerbose()) {
    logUpstream("openai-chat-completions-request", {
      url: upstreamUrl,
      headers: headersToLoggable(upstreamHeaders),
      body: parseJsonForLog(requestPayload),
    });
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, bridgeFetchInit(request, upstreamHeaders, requestPayload));
  } catch (error) {
    const message = formatUpstreamFetchError(error);
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: false,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: 0, streaming: stream },
      error: message,
      ...failureDebug(),
    });
    throw error;
  }

  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const isEventStream = contentType.includes("text/event-stream");

  if (!upstreamResponse.ok) {
    const responseText = await upstreamResponse.text();
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: false,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: upstreamResponse.status, streaming: stream },
      error: upstreamResponse.statusText || String(upstreamResponse.status),
      ...failureDebug(responseText),
    });
    response.writeHead(upstreamResponse.status, {
      "content-type": contentType || "application/json",
    });
    response.end(responseText);
    return;
  }

  if (!isEventStream) {
    const responseText = await upstreamResponse.text();
    let anthropicMessage: AnthropicResponse;
    try {
      anthropicMessage = parseBufferedOpenAIMessage(
        responseText,
        route.apiCompat,
        route.modelId,
        anthropicRequest,
      );
    } catch {
      logUpstreamProxyCall({
        at: new Date().toISOString(),
        ok: false,
        elapsedMs: Date.now() - startedAt,
        ...callCommon(),
        http: { status: upstreamResponse.status, streaming: stream },
        error: "无法解析 OpenAI Chat Completions 上游响应。",
        ...failureDebug(responseText),
      });
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "无法解析 OpenAI Chat Completions 上游响应。" }));
      return;
    }

    const usage = extractUsageFromResponseBody(anthropicMessage);
    const billing = usage
      ? await resolveProxyCallBilling(onUsage, buildBridgeUsageInfo(route, usage, requestedModel))
      : null;
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: true,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: upstreamResponse.status, streaming: stream },
      ...(usage && { tokens: tokensFromUsage(usage) }),
      billing,
    });
    writeBufferedAnthropicToClient(response, stream, anthropicMessage);
    return;
  }

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const ccToResState = newChatCompletionsToResponsesStreamState(route.modelId);
  const anthropicState = newResponsesEventToAnthropicState(requestToolNames);
  const sseSequence = newAnthropicStreamSequenceState();
  const sseViolations: string[] = [];
  const usageTracker = createStreamingUsageTracker();
  let sseBuffer = "";

  const writeAnthropicSse = (events: ReturnType<typeof responsesEventToAnthropicEvents>) => {
    for (const anthropicEvent of events) {
      const violation = checkAnthropicStreamEvent(sseSequence, anthropicEvent);
      if (violation) {
        sseViolations.push(`${anthropicEvent.type}: ${violation}`);
      }
      const sse = responsesAnthropicEventToSse(anthropicEvent);
      usageTracker.push(Buffer.from(sse, "utf8"));
      response.write(sse);
    }
  };

  const processChatChunk = (chunk: ChatCompletionsChunk) => {
    const responsesEvents = chatCompletionsChunkToResponsesEvents(chunk, ccToResState);
    for (const responsesEvent of responsesEvents) {
      writeAnthropicSse(responsesEventToAnthropicEvents(responsesEvent, anthropicState));
    }
  };

  try {
    if (!upstreamResponse.body) {
      response.end();
      return;
    }

    for await (const chunk of upstreamResponse.body as unknown as AsyncIterable<Uint8Array>) {
      sseBuffer += Buffer.from(chunk).toString("utf8");
      const { blocks, remainder } = splitSseBlocks(sseBuffer);
      sseBuffer = remainder;
      for (const block of blocks) {
        const chatChunk = parseChatCompletionsChunkBlock(block);
        if (!chatChunk) {
          continue;
        }
        processChatChunk(chatChunk);
      }
    }

    if (sseBuffer.trim()) {
      const { blocks } = splitSseBlocks(`${sseBuffer}\n\n`);
      for (const block of blocks) {
        const chatChunk = parseChatCompletionsChunkBlock(block);
        if (chatChunk) {
          processChatChunk(chatChunk);
        }
      }
    }

    for (const responsesEvent of finalizeChatCompletionsResponsesStream(ccToResState)) {
      writeAnthropicSse(responsesEventToAnthropicEvents(responsesEvent, anthropicState));
    }
    writeAnthropicSse(finalizeResponsesAnthropicStream(anthropicState));

    if (sseSequence.open.size > 0) {
      sseViolations.push(
        `流结束仍有未关闭的 content block: ${[...sseSequence.open].join(", ")}`,
      );
    }

    const usage = usageTracker.finish();
    const billing = usage
      ? await resolveProxyCallBilling(onUsage, buildBridgeUsageInfo(route, usage, requestedModel))
      : null;
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: true,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: upstreamResponse.status, streaming: stream },
      ...(usage && { tokens: tokensFromUsage(usage) }),
      billing,
    });
    if (sseViolations.length > 0) {
      logUpstreamError("sdk-stream-sequence", {
        role: route.role,
        modelId: route.modelId,
        aliasModelId: route.aliasModelId,
        violations: sseViolations.slice(0, 8),
        violationCount: sseViolations.length,
      });
    }
  } catch (error) {
    const message = formatUpstreamFetchError(error);
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: false,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: upstreamResponse.status, streaming: stream },
      error: message,
      ...failureDebug(),
    });
  } finally {
    if (!response.writableEnded) {
      response.end();
    }
  }
}

/** Provider connectivity probe: parse upstream reply via bridge. */
export async function parseBridgeProbeReply(params: {
  apiCompat: UpstreamApiCompat;
  modelId: string;
  anthropicRequest: AnthropicRequest;
  response: Response;
  preferStream: boolean;
}): Promise<string | undefined> {
  const contentType = params.response.headers.get("content-type") ?? "";
  const isEventStream = contentType.includes("text/event-stream");

  if (params.preferStream && isEventStream && params.response.body) {
    return collectBridgeProbeStreamReply(params);
  }

  const raw = await params.response.text();
  return parseBridgeProbeBufferedReply(
    raw,
    params.apiCompat,
    params.modelId,
    params.anthropicRequest,
  );
}

async function collectBridgeProbeStreamReply(params: {
  apiCompat: UpstreamApiCompat;
  modelId: string;
  anthropicRequest: AnthropicRequest;
  response: Response;
}): Promise<string | undefined> {
  const toolNames = extractAnthropicRequestToolNames(params.anthropicRequest);
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  let sseBuffer = "";

  const pushText = (events: ReturnType<typeof responsesEventToAnthropicEvents>) => {
    for (const event of events) {
      if (event.type !== "content_block_delta" || !event.delta) {
        continue;
      }
      if (event.delta.type === "text_delta" && event.delta.text) {
        textParts.push(event.delta.text);
      }
      if (event.delta.type === "thinking_delta" && event.delta.thinking) {
        thinkingParts.push(event.delta.thinking);
      }
    }
  };

  if (params.apiCompat === "openai_responses") {
    const state = newResponsesEventToAnthropicState(toolNames);
    for await (const chunk of params.response.body as AsyncIterable<Uint8Array>) {
      sseBuffer += Buffer.from(chunk).toString("utf8");
      const { blocks, remainder } = splitSseBlocks(sseBuffer);
      sseBuffer = remainder;
      for (const block of blocks) {
        const responsesEvent = parseResponsesStreamEventBlock(block);
        if (responsesEvent) {
          pushText(responsesEventToAnthropicEvents(responsesEvent, state));
        }
      }
    }
    if (sseBuffer.trim()) {
      const { blocks } = splitSseBlocks(`${sseBuffer}\n\n`);
      for (const block of blocks) {
        const responsesEvent = parseResponsesStreamEventBlock(block);
        if (responsesEvent) {
          pushText(responsesEventToAnthropicEvents(responsesEvent, state));
        }
      }
    }
    pushText(finalizeResponsesAnthropicStream(state));
  } else if (params.apiCompat === "openai_chat_completions") {
    const ccState = newChatCompletionsToResponsesStreamState(params.modelId);
    const anthropicState = newResponsesEventToAnthropicState(toolNames);
    for await (const chunk of params.response.body as AsyncIterable<Uint8Array>) {
      sseBuffer += Buffer.from(chunk).toString("utf8");
      const { blocks, remainder } = splitSseBlocks(sseBuffer);
      sseBuffer = remainder;
      for (const block of blocks) {
        const chatChunk = parseChatCompletionsChunkBlock(block);
        if (!chatChunk) {
          continue;
        }
        for (const responsesEvent of chatCompletionsChunkToResponsesEvents(chatChunk, ccState)) {
          pushText(responsesEventToAnthropicEvents(responsesEvent, anthropicState));
        }
      }
    }
    if (sseBuffer.trim()) {
      const { blocks } = splitSseBlocks(`${sseBuffer}\n\n`);
      for (const block of blocks) {
        const chatChunk = parseChatCompletionsChunkBlock(block);
        if (chatChunk) {
          for (const responsesEvent of chatCompletionsChunkToResponsesEvents(chatChunk, ccState)) {
            pushText(responsesEventToAnthropicEvents(responsesEvent, anthropicState));
          }
        }
      }
    }
    for (const responsesEvent of finalizeChatCompletionsResponsesStream(ccState)) {
      pushText(responsesEventToAnthropicEvents(responsesEvent, anthropicState));
    }
    pushText(finalizeResponsesAnthropicStream(anthropicState));
  } else {
    const anthToResState = newAnthropicEventToResponsesState();
    const anthropicState = newResponsesEventToAnthropicState(toolNames);
    for await (const chunk of params.response.body as AsyncIterable<Uint8Array>) {
      sseBuffer += Buffer.from(chunk).toString("utf8");
      const { blocks, remainder } = splitSseBlocks(sseBuffer);
      sseBuffer = remainder;
      for (const block of blocks) {
        const evt = parseAnthropicStreamEventBlock(block);
        if (!evt) {
          continue;
        }
        for (const responsesEvent of anthropicEventToResponsesEvents(evt, anthToResState)) {
          pushText(responsesEventToAnthropicEvents(responsesEvent, anthropicState));
        }
      }
    }
    if (sseBuffer.trim()) {
      const { blocks } = splitSseBlocks(`${sseBuffer}\n\n`);
      for (const block of blocks) {
        const evt = parseAnthropicStreamEventBlock(block);
        if (evt) {
          for (const responsesEvent of anthropicEventToResponsesEvents(evt, anthToResState)) {
            pushText(responsesEventToAnthropicEvents(responsesEvent, anthropicState));
          }
        }
      }
    }
    for (const responsesEvent of finalizeAnthropicResponsesStream(anthToResState)) {
      pushText(responsesEventToAnthropicEvents(responsesEvent, anthropicState));
    }
    pushText(finalizeResponsesAnthropicStream(anthropicState));
  }

  const text = textParts.join("").trim();
  if (text) {
    return text;
  }
  const thinking = thinkingParts.join("").trim();
  if (thinking) {
    return thinking;
  }
  return undefined;
}

function parseBridgeProbeBufferedReply(
  raw: string,
  apiCompat: UpstreamApiCompat,
  modelId: string,
  anthropicRequest: AnthropicRequest,
): string | undefined {
  try {
    if (apiCompat === "anthropic") {
      const message = parseBufferedAnthropicUpstreamMessage(raw);
      return extractTextFromAnthropicMessage(message);
    }
    const anthropic = parseBufferedOpenAIMessage(raw, apiCompat, modelId, anthropicRequest);
    return extractTextFromAnthropicMessage(anthropic);
  } catch {
    return undefined;
  }
}

function extractTextFromAnthropicMessage(message: AnthropicResponse): string | undefined {
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text" && block.text?.trim()) {
      textParts.push(block.text.trim());
    }
    if (block.type === "thinking" && block.thinking?.trim()) {
      thinkingParts.push(block.thinking.trim());
    }
  }
  if (textParts.length > 0) {
    return textParts.join("\n").trim();
  }
  if (thinkingParts.length > 0) {
    return thinkingParts.join("\n").trim();
  }
  return undefined;
}
