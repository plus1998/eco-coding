import http, { type IncomingHttpHeaders } from "node:http";
import {
  anthropicToResponses,
  chatCompletionsChunkToResponsesEvents,
  chatCompletionsResponseToResponses,
  finalizeChatCompletionsResponsesStream,
  finalizeResponsesAnthropicStream,
  newChatCompletionsToResponsesStreamState,
  newResponsesEventToAnthropicState,
  responsesAnthropicEventToSse,
  responsesEventToAnthropicEvents,
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
  buildOpenAIHeaders,
} from "./provider-models";
import type { ProviderConfigSecret } from "./provider-store";
import {
  createStreamingUsageTracker,
  extractUsageFromResponseBody,
} from "./anthropic-usage";
import { headersToLoggable, logUpstream, parseJsonForLog, truncateForLog } from "./upstream-log";

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

export interface OpenAICompatForwardRoute {
  role: string;
  provider: ProviderConfigSecret;
  modelId: string;
  apiCompat: UpstreamApiCompat;
}

export interface OpenAICompatForwardContext {
  route: OpenAICompatForwardRoute;
  body: Record<string, unknown>;
  requestedModel?: string;
  onUsage?: (info: OpenAICompatUsageInfo) => void;
}

function buildUpstreamHeaders(
  clientHeaders: IncomingHttpHeaders,
  apiKey: string,
): Record<string, string> {
  const headers = buildOpenAIHeaders(apiKey);
  const contentType = clientHeaders["content-type"];
  if (typeof contentType === "string") {
    headers["content-type"] = contentType;
  }
  return headers;
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
): AnthropicResponse {
  const parsed = JSON.parse(responseText) as Record<string, unknown>;
  if (parsed.type === "message" && Array.isArray(parsed.content)) {
    return parsed as AnthropicResponse;
  }
  return responsesToAnthropic(parsed as ResponsesResponse, modelId);
}

function parseBufferedChatCompletionsMessage(
  responseText: string,
  modelId: string,
): AnthropicResponse {
  const parsed = JSON.parse(responseText) as Record<string, unknown>;
  if (parsed.type === "message" && Array.isArray(parsed.content)) {
    return parsed as AnthropicResponse;
  }
  return responsesToAnthropic(
    chatCompletionsResponseToResponses(parsed as ChatCompletionsResponse),
    modelId,
  );
}

function writeBufferedOpenAICompatToClient(
  response: http.ServerResponse,
  stream: boolean,
  anthropicMessage: AnthropicResponse,
  onUsage?: OpenAICompatForwardContext["onUsage"],
  usageContext?: {
    role: string;
    provider: OpenAICompatForwardRoute["provider"];
    modelId: string;
    requestedModel?: string;
  },
): void {
  const usage = extractUsageFromResponseBody(anthropicMessage);
  if (usage && onUsage && usageContext) {
    onUsage({
      role: usageContext.role as AgentRole,
      providerId: usageContext.provider.id,
      providerName: usageContext.provider.name,
      providerBaseUrl: usageContext.provider.baseUrl,
      modelId: usageContext.modelId,
      ...(usageContext.requestedModel && { requestedModel: usageContext.requestedModel }),
      usage,
    });
  }

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

async function forwardMessagesViaOpenAIResponses(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  ctx: OpenAICompatForwardContext,
): Promise<void> {
  const { route, body, requestedModel, onUsage } = ctx;
  const upstreamUrl = buildOpenAICompatUpstreamUrl(
    route.provider.baseUrl,
    route.provider.requestPath,
  );
  const responsesReq = anthropicToResponses(body as AnthropicRequest);
  responsesReq.model = route.modelId;
  const stream = body.stream === true;
  responsesReq.stream = stream;

  const requestPayload = JSON.stringify(responsesReq);
  const upstreamHeaders = buildUpstreamHeaders(request.headers, route.provider.apiKey);

  logUpstream("openai-responses-request", {
    route: {
      role: route.role,
      provider: route.provider.name,
      apiCompat: route.apiCompat,
    },
    url: upstreamUrl,
    apiSurface: "openai-v1-responses",
    model: { sdkRequested: requestedModel, upstream: route.modelId },
    headers: headersToLoggable(upstreamHeaders),
    body: parseJsonForLog(requestPayload),
  });

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: requestPayload,
      signal: request.signal as AbortSignal | undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logUpstream("openai-responses-fetch-error", { error: message });
    throw error;
  }

  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const isEventStream = contentType.includes("text/event-stream");

  if (!upstreamResponse.ok) {
    const responseText = await upstreamResponse.text();
    logUpstream("openai-responses-response", {
      status: upstreamResponse.status,
      body: parseJsonForLog(responseText) ?? truncateForLog(responseText),
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
      anthropicMessage = parseBufferedAnthropicMessage(responseText, route.modelId);
    } catch {
      logUpstream("openai-responses-parse-error", { body: truncateForLog(responseText) });
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "无法解析 OpenAI Responses 上游响应。" }));
      return;
    }

    logUpstream("openai-responses-response", {
      status: upstreamResponse.status,
      stream,
      deliveredAs: stream ? "anthropic-sse-replay" : "json",
      body: parseJsonForLog(JSON.stringify(anthropicMessage)),
    });
    writeBufferedOpenAICompatToClient(response, stream, anthropicMessage, onUsage, {
      role: route.role,
      provider: route.provider,
      modelId: route.modelId,
      ...(requestedModel && { requestedModel }),
    });
    return;
  }

  logUpstream("openai-responses-response", {
    status: upstreamResponse.status,
    body: stream ? "(streaming)" : "(sse-upstream-non-stream-client)",
  });
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const anthropicState = newResponsesEventToAnthropicState();
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
    if (usage && onUsage) {
      onUsage({
        role: route.role as AgentRole,
        providerId: route.provider.id,
        providerName: route.provider.name,
        providerBaseUrl: route.provider.baseUrl,
        modelId: route.modelId,
        ...(requestedModel && { requestedModel }),
        usage,
      });
    }
  } catch (error) {
    logUpstream("openai-responses-stream-error", {
      error: error instanceof Error ? error.message : String(error),
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
  const { route, body, requestedModel, onUsage } = ctx;
  const upstreamUrl = buildChatCompletionsUrl(route.provider.baseUrl, route.provider.requestPath);
  const responsesReq = anthropicToResponses(body as AnthropicRequest);
  responsesReq.model = route.modelId;
  const stream = body.stream === true;
  const chatReq = responsesToChatCompletionsRequest(responsesReq);
  chatReq.model = route.modelId;
  chatReq.stream = stream;

  const requestPayload = JSON.stringify(chatReq);
  const upstreamHeaders = buildUpstreamHeaders(request.headers, route.provider.apiKey);

  logUpstream("openai-chat-completions-request", {
    route: {
      role: route.role,
      provider: route.provider.name,
      apiCompat: route.apiCompat,
    },
    url: upstreamUrl,
    apiSurface: "openai-v1-chat-completions",
    model: { sdkRequested: requestedModel, upstream: route.modelId },
    headers: headersToLoggable(upstreamHeaders),
    body: parseJsonForLog(requestPayload),
  });

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: requestPayload,
      signal: request.signal as AbortSignal | undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logUpstream("openai-chat-completions-fetch-error", { error: message });
    throw error;
  }

  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const isEventStream = contentType.includes("text/event-stream");

  if (!upstreamResponse.ok) {
    const responseText = await upstreamResponse.text();
    logUpstream("openai-chat-completions-response", {
      status: upstreamResponse.status,
      body: parseJsonForLog(responseText) ?? truncateForLog(responseText),
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
      anthropicMessage = parseBufferedChatCompletionsMessage(responseText, route.modelId);
    } catch {
      logUpstream("openai-chat-completions-parse-error", { body: truncateForLog(responseText) });
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "无法解析 OpenAI Chat Completions 上游响应。" }));
      return;
    }

    logUpstream("openai-chat-completions-response", {
      status: upstreamResponse.status,
      stream,
      deliveredAs: stream ? "anthropic-sse-replay" : "json",
      body: parseJsonForLog(JSON.stringify(anthropicMessage)),
    });
    writeBufferedOpenAICompatToClient(response, stream, anthropicMessage, onUsage, {
      role: route.role,
      provider: route.provider,
      modelId: route.modelId,
      ...(requestedModel && { requestedModel }),
    });
    return;
  }

  logUpstream("openai-chat-completions-response", {
    status: upstreamResponse.status,
    body: "(streaming)",
  });
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const ccToResState = newChatCompletionsToResponsesStreamState();
  const anthropicState = newResponsesEventToAnthropicState();
  const usageTracker = createStreamingUsageTracker();
  let sseBuffer = "";

  const writeAnthropicSse = (events: ReturnType<typeof responsesEventToAnthropicEvents>) => {
    for (const anthropicEvent of events) {
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

    const usage = usageTracker.finish();
    if (usage && onUsage) {
      onUsage({
        role: route.role as AgentRole,
        providerId: route.provider.id,
        providerName: route.provider.name,
        providerBaseUrl: route.provider.baseUrl,
        modelId: route.modelId,
        ...(requestedModel && { requestedModel }),
        usage,
      });
    }
  } catch (error) {
    logUpstream("openai-chat-completions-stream-error", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (!response.writableEnded) {
      response.end();
    }
  }
}
