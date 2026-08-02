import type { ResponsesRequest, ResponsesUsage } from "@eco/openai-anthropic-bridge";
import { buildUpstreamUrl } from "../provider-router.js";
import type { ResolvedProviderRoute } from "../types.js";
import { parseResponsesStreamEventBlock, splitSseBlocks } from "../sse.js";
import type { GatewayLogFn } from "../server.js";
import type {
  GatewayCodexTurnMetadata,
  GatewayUsageEvent,
  GatewayUsageObserver,
} from "../types.js";
import {
  extractUsageFromResponsesStreamEvent,
  normalizeResponsesUsage,
  type ParsedUsage,
} from "../usage-normalize.js";
import { upstreamErrorResponse } from "./upstream-error.js";
import { applyUpstreamUserAgent } from "./user-agent.js";

let usageEventSeq = 0;

function buildOpenAIUpstreamHeaders(
  providerApiKey: string,
  clientHeaders: Headers,
  upstreamUserAgent?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${providerApiKey}`,
  };
  const openAiOrg = clientHeaders.get("openai-organization");
  if (openAiOrg) {
    headers["openai-organization"] = openAiOrg;
  }
  const openAiProject = clientHeaders.get("openai-project");
  if (openAiProject) {
    headers["openai-project"] = openAiProject;
  }
  applyUpstreamUserAgent(headers, clientHeaders, upstreamUserAgent);
  return headers;
}

/** Pass Responses request body to an upstream that already speaks Responses API. */
export async function forwardResponsesPassthrough(
  route: ResolvedProviderRoute,
  responsesBody: ResponsesRequest,
  clientHeaders: Headers,
  fetchImpl: typeof fetch = fetch,
  onLog: GatewayLogFn = () => undefined,
  onUsage?: GatewayUsageObserver,
  codexTurnMetadata?: GatewayCodexTurnMetadata,
  upstreamUserAgent?: string,
): Promise<Response> {
  const upstreamBody: ResponsesRequest = {
    ...responsesBody,
    model: route.upstreamModelId,
  };

  const upstreamUrl = buildUpstreamUrl(route.provider, route.upstreamKind);
  const upstreamHeaders = buildOpenAIUpstreamHeaders(
    route.provider.apiKey,
    clientHeaders,
    upstreamUserAgent,
  );
  const payload = JSON.stringify(upstreamBody);
  onLog(
    `upstream POST ${upstreamUrl} provider=${route.provider.id} model=${route.upstreamModelId} bytes=${payload.length}`,
  );

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetchImpl(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: payload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onLog(`upstream fetch failed ${upstreamUrl}: ${message}`);
    return Response.json(
      {
        error: {
          message: `Upstream provider ${route.provider.id} · model=${route.upstreamModelId} · url=${upstreamUrl} · ${message}`,
          type: "upstream_error",
          providerId: route.provider.id,
          model: route.upstreamModelId,
          url: upstreamUrl,
        },
      },
      { status: 502 },
    );
  }

  onLog(`upstream response ${upstreamUrl} status=${upstreamResponse.status}`);
  if (!upstreamResponse.ok) {
    const text = await upstreamResponse.text();
    onLog(`upstream error body: ${text.slice(0, 300)}`);
    return upstreamErrorResponse({
      route,
      upstreamUrl,
      status: upstreamResponse.status,
      bodyText: text,
    });
  }

  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const providerRequestId = readProviderRequestId(upstreamResponse.headers);
  if (!contentType.includes("text/event-stream") || !upstreamResponse.body) {
    const text = await upstreamResponse.text();
    observeResponsesJsonUsage({
      route,
      text,
      stream: false,
      ...(providerRequestId && { providerRequestId }),
      ...(codexTurnMetadata && { codexTurnMetadata }),
      onUsage,
      onLog,
    });
    return new Response(text, {
      status: 200,
      headers: { "content-type": contentType || "application/json" },
    });
  }

  const observedBody = observeResponsesSseUsage({
    route,
    body: upstreamResponse.body,
    ...(providerRequestId && { providerRequestId }),
    ...(codexTurnMetadata && { codexTurnMetadata }),
    onUsage,
    onLog,
  });

  return new Response(observedBody, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

function readProviderRequestId(headers: Headers): string | undefined {
  return (
    headers.get("x-request-id")?.trim() ||
    headers.get("request-id")?.trim() ||
    headers.get("openai-request-id")?.trim() ||
    undefined
  );
}

function observeResponsesJsonUsage(input: {
  route: ResolvedProviderRoute;
  text: string;
  stream: boolean;
  providerRequestId?: string;
  codexTurnMetadata?: GatewayCodexTurnMetadata;
  onUsage: GatewayUsageObserver | undefined;
  onLog: GatewayLogFn;
}): void {
  if (!input.onUsage) {
    return;
  }
  const parsed = parseResponsesJsonUsage(input.text, input.route.upstreamModelId);
  if (!parsed?.usage) {
    return;
  }
  emitGatewayUsage({
    route: input.route,
    usage: parsed.usage,
    stream: input.stream,
    ...(parsed.responseId && { responseId: parsed.responseId }),
    ...(input.providerRequestId && { providerRequestId: input.providerRequestId }),
    ...(input.codexTurnMetadata && { codexTurnMetadata: input.codexTurnMetadata }),
    onUsage: input.onUsage,
    onLog: input.onLog,
  });
}

function parseResponsesJsonUsage(
  text: string,
  fallbackModelId: string,
): { usage: ParsedUsage; responseId?: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const response = isRecord(parsed) && isRecord(parsed.response) ? parsed.response : parsed;
  if (!isRecord(response) || !isRecord(response.usage)) {
    return null;
  }
  const modelId = readString(response, "model") ?? fallbackModelId;
  const usage = normalizeResponsesUsage(response.usage as unknown as ResponsesUsage, modelId);
  if (!usage) {
    return null;
  }
  const responseId = readString(response, "id");
  return {
    usage,
    ...(responseId && { responseId }),
  };
}

function observeResponsesSseUsage(input: {
  route: ResolvedProviderRoute;
  body: ReadableStream<Uint8Array>;
  providerRequestId?: string;
  codexTurnMetadata?: GatewayCodexTurnMetadata;
  onUsage: GatewayUsageObserver | undefined;
  onLog: GatewayLogFn;
}): ReadableStream<Uint8Array> {
  if (!input.onUsage) {
    return input.body;
  }
  const onUsage = input.onUsage;

  const decoder = new TextDecoder();
  let buffer = "";
  let usageEmitted = false;

  const observeBlock = (block: string) => {
    if (usageEmitted) {
      return;
    }
    const event = parseResponsesStreamEventBlock(block);
    if (!event) {
      return;
    }
    const usage = extractUsageFromResponsesStreamEvent(event, input.route.upstreamModelId);
    if (!usage) {
      return;
    }
    usageEmitted = true;
    const response = isRecord(event.response) ? event.response : undefined;
    const responseId = response ? readString(response, "id") : undefined;
    emitGatewayUsage({
      route: input.route,
      usage,
      stream: true,
      ...(responseId && { responseId }),
      ...(input.providerRequestId && { providerRequestId: input.providerRequestId }),
      ...(input.codexTurnMetadata && { codexTurnMetadata: input.codexTurnMetadata }),
      onUsage,
      onLog: input.onLog,
    });
  };

  return input.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        buffer += decoder.decode(chunk, { stream: true });
        const { blocks, remainder } = splitSseBlocks(buffer);
        buffer = remainder;
        for (const block of blocks) {
          observeBlock(block);
        }
      },
      flush() {
        buffer += decoder.decode();
        if (!buffer.trim()) {
          return;
        }
        const { blocks } = splitSseBlocks(`${buffer}\n\n`);
        for (const block of blocks) {
          observeBlock(block);
        }
      },
    }),
  );
}

function emitGatewayUsage(input: {
  route: ResolvedProviderRoute;
  usage: ParsedUsage;
  stream: boolean;
  responseId?: string;
  providerRequestId?: string;
  codexTurnMetadata?: GatewayCodexTurnMetadata;
  onUsage: GatewayUsageObserver;
  onLog: GatewayLogFn;
}): void {
  const sourceEventId = buildGatewayUsageSourceEventId(input);
  const event: GatewayUsageEvent = {
    source: "responses",
    sourceEventId,
    providerId: input.route.provider.id,
    requestedModel: input.route.requestedModel,
    upstreamModelId: input.route.upstreamModelId,
    usage: input.usage,
    stream: input.stream,
    observedAt: new Date().toISOString(),
    ...(input.responseId && { responseId: input.responseId }),
    ...(input.providerRequestId && { providerRequestId: input.providerRequestId }),
    ...(input.codexTurnMetadata && { codexTurnMetadata: input.codexTurnMetadata }),
  };
  try {
    void Promise.resolve(input.onUsage(event)).catch((error) => {
      input.onLog(`usage observer failed: ${errorMessage(error)}`);
    });
  } catch (error) {
    input.onLog(`usage observer failed: ${errorMessage(error)}`);
  }
}

function buildGatewayUsageSourceEventId(input: {
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
  usageEventSeq += 1;
  return [
    "responses",
    input.route.provider.id,
    input.route.requestedModel,
    Date.now(),
    usageEventSeq,
  ].join(":");
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Collect Responses SSE events from a stream (test helper). */
export async function collectResponsesSseEvents(body: ReadableStream<Uint8Array>): Promise<string[]> {
  const decoder = new TextDecoder();
  let buffer = "";
  const events: string[] = [];

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const { blocks, remainder } = splitSseBlocks(buffer);
    buffer = remainder;
    for (const block of blocks) {
      const evt = parseResponsesStreamEventBlock(block);
      if (evt?.type) {
        events.push(evt.type);
      }
    }
  }

  if (buffer.trim()) {
    const { blocks } = splitSseBlocks(`${buffer}\n\n`);
    for (const block of blocks) {
      const evt = parseResponsesStreamEventBlock(block);
      if (evt?.type) {
        events.push(evt.type);
      }
    }
  }

  return events;
}
