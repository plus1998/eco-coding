import http from "node:http";
import {
  anthropicToResponses,
  anthropicToResponsesInputTokensBody,
  chatCompletionsChunkToResponsesEvents,
  chatCompletionsResponseToResponses,
  extractAnthropicRequestToolNames,
  finalizeChatCompletionsResponsesStream,
  finalizeResponsesAnthropicStream,
  newChatCompletionsToResponsesStreamState,
  newResponsesEventToAnthropicState,
  checkAnthropicStreamEvent,
  newAnthropicStreamSequenceState,
  responsesAnthropicEventToSse,
  responsesEventToAnthropicEvents,
  responsesInputTokensToAnthropicCount,
  responsesToAnthropic,
  responsesToChatCompletionsRequest,
  type AnthropicRequest,
  type AnthropicResponse,
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
  buildResponsesInputTokensUrl,
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
import { headersToLoggable, logUpstream, logUpstreamError, parseJsonForLog, formatUpstreamFetchError } from "./upstream-log";

export interface OpenAICompatUsageInfo {
  role: AgentRole;
  providerId: string;
  providerName: string;
  providerBaseUrl: string;
  modelId: string;
  requestedModel?: string;
  requestId?: string;
  usage: ParsedUsage;
}

export type OpenAICompatUsageHandler = (
  info: OpenAICompatUsageInfo,
) => void | Promise<UpstreamProxyCallBilling | null | undefined>;

export interface OpenAICompatForwardRoute {
  role: string;
  provider: ProviderConfigSecret;
  modelId: string;
  apiCompat: UpstreamApiCompat;
  aliasModelId: string;
}

export interface OpenAICompatForwardContext {
  route: OpenAICompatForwardRoute;
  body: Record<string, unknown>;
  requestedModel?: string;
  requestUrl?: string;
  upstreamUserAgent?: string;
  onUsage?: OpenAICompatUsageHandler;
}

function buildOpenAICompatUpstreamHeaders(
  request: http.IncomingMessage,
  route: OpenAICompatForwardRoute,
  upstreamUserAgent?: string,
): Record<string, string> {
  return buildProxyUpstreamHeaders({
    clientHeaders: request.headers,
    apiKey: route.provider.apiKey,
    apiCompat: route.apiCompat,
    ...(upstreamUserAgent ? { upstreamUserAgent } : {}),
  });
}

function splitSseBlocks(buffer: string): { blocks: string[]; remainder: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const remainder = parts.pop() ?? "";
  return { blocks: parts.filter((block) => block.trim()), remainder };
}

function parseResponsesStreamEventBlock(block: string): ResponsesStreamEvent | null {
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

function parseBufferedAnthropicMessage(
  responseText: string,
  modelId: string,
  requestBody?: AnthropicRequest,
): AnthropicResponse {
  const toolNames = requestBody ? extractAnthropicRequestToolNames(requestBody) : [];
  const parsed = JSON.parse(responseText) as Record<string, unknown>;
  if (parsed.type === "message" && Array.isArray(parsed.content)) {
    return parsed as AnthropicResponse;
  }
  return responsesToAnthropic(parsed as ResponsesResponse, modelId, toolNames);
}

function parseBufferedChatCompletionsMessage(
  responseText: string,
  modelId: string,
  requestBody?: AnthropicRequest,
): AnthropicResponse {
  const toolNames = requestBody ? extractAnthropicRequestToolNames(requestBody) : [];
  const parsed = JSON.parse(responseText) as Record<string, unknown>;
  if (parsed.type === "message" && Array.isArray(parsed.content)) {
    return parsed as AnthropicResponse;
  }
  return responsesToAnthropic(
    chatCompletionsResponseToResponses(parsed as ChatCompletionsResponse),
    modelId,
    toolNames,
  );
}

function writeBufferedOpenAICompatToClient(
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

function buildOpenAICompatUsageInfo(
  route: OpenAICompatForwardRoute,
  usage: ParsedUsage,
  requestedModel?: string,
): OpenAICompatUsageInfo {
  return {
    role: route.role as AgentRole,
    providerId: route.provider.id,
    providerName: route.provider.name,
    providerBaseUrl: route.provider.baseUrl,
    modelId: route.modelId,
    ...(requestedModel && { requestedModel }),
    usage,
  };
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

export async function forwardMessagesViaOpenAICompat(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  ctx: OpenAICompatForwardContext,
): Promise<void> {
  if (ctx.route.apiCompat === "openai_chat_completions") {
    return forwardMessagesViaOpenAIChatCompletions(request, response, ctx);
  }
  return forwardMessagesViaOpenAIResponses(request, response, ctx);
}

export async function forwardCountTokensViaOpenAICompat(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  ctx: OpenAICompatForwardContext,
): Promise<void> {
  const { route, body, requestedModel, requestUrl } = ctx;
  const startedAt = Date.now();
  const upstreamUrl = buildResponsesInputTokensUrl(
    route.provider.baseUrl,
    route.provider.requestPath,
  );
  const upstreamBody = anthropicToResponsesInputTokensBody(body as AnthropicRequest);
  upstreamBody.model = route.modelId;

  const requestPayload = JSON.stringify(upstreamBody);
  const anthropicRequestPayload = JSON.stringify(body);
  const upstreamHeaders = buildOpenAICompatUpstreamHeaders(request, route, ctx.upstreamUserAgent);
  const callCommon = () =>
    proxyCallCommonFields({
      role: route.role,
      provider: route.provider,
      apiCompat: route.apiCompat,
      modelId: route.modelId,
      aliasModelId: route.aliasModelId,
      requestedModel,
      requestUrl,
      upstreamUrl,
      stream: false,
      converted: true,
    });
  const failureDebug = (responseRaw?: string) =>
    buildProxyCallDebug({
      converted: true,
      clientRequestRaw: anthropicRequestPayload,
      upstreamRequestRaw: requestPayload,
      responseRaw,
    });

  if (isUpstreamLogVerbose()) {
    logUpstream("openai-responses-input-tokens-request", {
      url: upstreamUrl,
      headers: headersToLoggable(upstreamHeaders),
      body: parseJsonForLog(requestPayload),
    });
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: requestPayload,
      signal: request.signal as AbortSignal | undefined,
    });
  } catch (error) {
    const message = formatUpstreamFetchError(error);
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: false,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: 0, streaming: false },
      error: message,
      debug: failureDebug(),
    });
    throw error;
  }

  const responseText = await upstreamResponse.text();

  if (!upstreamResponse.ok) {
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: false,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: upstreamResponse.status, streaming: false },
      error: upstreamResponse.statusText || String(upstreamResponse.status),
      debug: failureDebug(responseText),
    });
    response.writeHead(upstreamResponse.status, {
      "content-type": upstreamResponse.headers.get("content-type") ?? "application/json",
    });
    response.end(responseText);
    return;
  }

  let anthropicCount: { input_tokens: number };
  try {
    anthropicCount = responsesInputTokensToAnthropicCount(JSON.parse(responseText));
  } catch (error) {
    const message = formatUpstreamFetchError(error);
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: false,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: upstreamResponse.status, streaming: false },
      error: `无法解析 OpenAI Responses input_tokens 响应：${message}`,
      debug: failureDebug(responseText),
    });
    response.writeHead(502, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ error: "无法解析 OpenAI Responses input_tokens 响应。" }),
    );
    return;
  }

  logUpstreamProxyCall({
    at: new Date().toISOString(),
    ok: true,
    elapsedMs: Date.now() - startedAt,
    ...callCommon(),
    http: { status: upstreamResponse.status, streaming: false },
    tokens: {
      input: anthropicCount.input_tokens,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
    },
    billing: null,
  });

  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(anthropicCount));
}

async function forwardMessagesViaOpenAIResponses(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  ctx: OpenAICompatForwardContext,
): Promise<void> {
  const { route, body, requestedModel, onUsage, requestUrl } = ctx;
  const startedAt = Date.now();
  const upstreamUrl = buildOpenAICompatUpstreamUrl(
    route.provider.baseUrl,
    route.provider.requestPath,
  );
  const anthropicRequest = body as AnthropicRequest;
  const requestToolNames = extractAnthropicRequestToolNames(anthropicRequest);
  const responsesReq = anthropicToResponses(anthropicRequest);
  responsesReq.model = route.modelId;
  const stream = body.stream === true;
  responsesReq.stream = stream;

  const requestPayload = JSON.stringify(responsesReq);
  const upstreamHeaders = buildOpenAICompatUpstreamHeaders(request, route, ctx.upstreamUserAgent);
  const anthropicRequestPayload = JSON.stringify(body);
  const callCommon = () =>
    proxyCallCommonFields({
      role: route.role,
      provider: route.provider,
      apiCompat: route.apiCompat,
      modelId: route.modelId,
      aliasModelId: route.aliasModelId,
      requestedModel,
      requestUrl,
      upstreamUrl,
      stream,
      converted: true,
    });
  const failureDebug = (responseRaw?: string) =>
    buildProxyCallDebug({
      converted: true,
      clientRequestRaw: anthropicRequestPayload,
      upstreamRequestRaw: requestPayload,
      responseRaw,
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
    upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: requestPayload,
      signal: request.signal as AbortSignal | undefined,
    });
  } catch (error) {
    const message = formatUpstreamFetchError(error);
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: false,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: 0, streaming: stream },
      error: message,
      debug: failureDebug(),
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
      debug: failureDebug(responseText),
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
      anthropicMessage = parseBufferedAnthropicMessage(responseText, route.modelId, anthropicRequest);
    } catch {
      logUpstreamProxyCall({
        at: new Date().toISOString(),
        ok: false,
        elapsedMs: Date.now() - startedAt,
        ...callCommon(),
        http: { status: upstreamResponse.status, streaming: stream },
        error: "无法解析 OpenAI Responses 上游响应。",
        debug: failureDebug(responseText),
      });
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "无法解析 OpenAI Responses 上游响应。" }));
      return;
    }

    const usage = extractUsageFromResponseBody(anthropicMessage);
    const billing = usage
      ? await resolveProxyCallBilling(onUsage, buildOpenAICompatUsageInfo(route, usage, requestedModel))
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
    writeBufferedOpenAICompatToClient(response, stream, anthropicMessage);
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
        if (!responsesEvent) {
          continue;
        }
        writeAnthropicSse(responsesEventToAnthropicEvents(responsesEvent, anthropicState));
      }
    }

    writeAnthropicSse(finalizeResponsesAnthropicStream(anthropicState));

    const usage = usageTracker.finish();
    const billing = usage
      ? await resolveProxyCallBilling(onUsage, buildOpenAICompatUsageInfo(route, usage, requestedModel))
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
      debug: failureDebug(),
    });
  } finally {
    if (!response.writableEnded) {
      response.end();
    }
  }
}

async function forwardMessagesViaOpenAIChatCompletions(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  ctx: OpenAICompatForwardContext,
): Promise<void> {
  const { route, body, requestedModel, onUsage, requestUrl } = ctx;
  const startedAt = Date.now();
  const upstreamUrl = buildChatCompletionsUrl(route.provider.baseUrl, route.provider.requestPath);
  const anthropicRequest = body as AnthropicRequest;
  const requestToolNames = extractAnthropicRequestToolNames(anthropicRequest);
  const responsesReq = anthropicToResponses(anthropicRequest);
  responsesReq.model = route.modelId;
  const stream = body.stream === true;
  const chatReq = responsesToChatCompletionsRequest(responsesReq);
  chatReq.model = route.modelId;
  chatReq.stream = stream;

  const requestPayload = JSON.stringify(chatReq);
  const upstreamHeaders = buildOpenAICompatUpstreamHeaders(request, route, ctx.upstreamUserAgent);
  const anthropicRequestPayload = JSON.stringify(body);
  const callCommon = () =>
    proxyCallCommonFields({
      role: route.role,
      provider: route.provider,
      apiCompat: route.apiCompat,
      modelId: route.modelId,
      aliasModelId: route.aliasModelId,
      requestedModel,
      requestUrl,
      upstreamUrl,
      stream,
      converted: true,
    });
  const failureDebug = (responseRaw?: string) =>
    buildProxyCallDebug({
      converted: true,
      clientRequestRaw: anthropicRequestPayload,
      upstreamRequestRaw: requestPayload,
      responseRaw,
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
    upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: requestPayload,
      signal: request.signal as AbortSignal | undefined,
    });
  } catch (error) {
    const message = formatUpstreamFetchError(error);
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: false,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: 0, streaming: stream },
      error: message,
      debug: failureDebug(),
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
      debug: failureDebug(responseText),
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
      anthropicMessage = parseBufferedChatCompletionsMessage(responseText, route.modelId, anthropicRequest);
    } catch {
      logUpstreamProxyCall({
        at: new Date().toISOString(),
        ok: false,
        elapsedMs: Date.now() - startedAt,
        ...callCommon(),
        http: { status: upstreamResponse.status, streaming: stream },
        error: "无法解析 OpenAI Chat Completions 上游响应。",
        debug: failureDebug(responseText),
      });
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "无法解析 OpenAI Chat Completions 上游响应。" }));
      return;
    }

    const usage = extractUsageFromResponseBody(anthropicMessage);
    const billing = usage
      ? await resolveProxyCallBilling(onUsage, buildOpenAICompatUsageInfo(route, usage, requestedModel))
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
    writeBufferedOpenAICompatToClient(response, stream, anthropicMessage);
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
      ? await resolveProxyCallBilling(onUsage, buildOpenAICompatUsageInfo(route, usage, requestedModel))
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
        hint: "上游 HTTP 200 但合成的 Anthropic SSE 不符合 SDK 要求，可能导致 Content block not found",
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
      debug: failureDebug(),
    });
  } finally {
    if (!response.writableEnded) {
      response.end();
    }
  }
}
