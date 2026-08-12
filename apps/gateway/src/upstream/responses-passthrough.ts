import type { ResponsesRequest, ResponsesUsage } from "@eco/openai-anthropic-bridge";
import { buildUpstreamUrl } from "../provider-router.js";
import type { GatewayLogFn } from "../server.js";
import { parseResponsesStreamEventBlock, splitSseBlocks } from "../sse.js";
import type {
  GatewayCodexTurnMetadata,
  GatewayUsageEvent,
  GatewayUsageObserver,
  ResolvedProviderRoute,
} from "../types.js";
import {
  extractUsageFromResponsesStreamEvent,
  normalizeResponsesUsage,
  type ParsedUsage,
} from "../usage-normalize.js";
import {
  fetchWithRequestLifecycle,
  reportLogicalUpstreamFailure,
  tryEmitLogicalCancelled,
  tryEmitLogicalCompleted,
  type RequestLifecycleContext,
} from "../request-lifecycle.js";
import { headersWithLogicalRequestIdentity, readUpstreamRequestId } from "./request-id-headers.js";
import { responsesFailedSse } from "./responses-stream-errors.js";
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

/**
 * DeepSeek Responses (and compatible gateways) accept only custom tool
 * `apply_patch`; other custom names (notably Codex freeform `exec`) return 400.
 * function/web_search pass; unknown tool types are ignored by DeepSeek.
 */
export function isDeepSeekResponsesUpstreamModel(modelId: string): boolean {
  const id = modelId.trim();
  return /\bdeepseek\b/i.test(id) || /^deepseek/i.test(id);
}

export function sanitizeDeepSeekResponsesCustomTools(
  body: ResponsesRequest,
  upstreamModelId: string,
): ResponsesRequest {
  if (!isDeepSeekResponsesUpstreamModel(upstreamModelId)) {
    return body;
  }
  const tools = body.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    return body;
  }
  const filtered = tools.filter((tool) => {
    if (!tool || typeof tool !== "object") {
      return true;
    }
    if (tool.type !== "custom") {
      return true;
    }
    return tool.name === "apply_patch";
  });
  if (filtered.length === tools.length) {
    return body;
  }
  return { ...body, tools: filtered as ResponsesRequest["tools"] };
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
  lifecycle?: RequestLifecycleContext,
): Promise<Response> {
  const sanitized = sanitizeDeepSeekResponsesCustomTools(responsesBody, route.upstreamModelId);
  const upstreamBody: ResponsesRequest = {
    ...sanitized,
    model: route.upstreamModelId,
  };

  const upstreamUrl = buildUpstreamUrl(route.provider, route.upstreamKind);
  const upstreamHeaders = buildOpenAIUpstreamHeaders(route.provider.apiKey, clientHeaders, upstreamUserAgent);
  const payload = JSON.stringify(upstreamBody);
  onLog(
    `upstream POST ${upstreamUrl} provider=${route.provider.id} model=${route.upstreamModelId} bytes=${payload.length}`,
  );

  let upstreamResponse: Response;
  try {
    upstreamResponse = lifecycle
      ? await fetchWithRequestLifecycle(
          fetchImpl,
          upstreamUrl,
          {
            method: "POST",
            headers: upstreamHeaders,
            body: payload,
          },
          lifecycle,
        )
      : await fetchImpl(upstreamUrl, {
          method: "POST",
          headers: upstreamHeaders,
          body: payload,
        });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onLog(`upstream fetch failed ${upstreamUrl}: ${message}`);
    reportLogicalUpstreamFailure(lifecycle, { stage: "transport", error: message });
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
    const providerRequestId = readUpstreamRequestId(upstreamResponse.headers);
    reportLogicalUpstreamFailure(lifecycle, {
      stage: "http",
      error: `Upstream returned HTTP ${upstreamResponse.status}`,
      statusCode: upstreamResponse.status,
      ...(providerRequestId ? { providerRequestId } : {}),
    });
    return upstreamErrorResponse({
      route,
      upstreamUrl,
      status: upstreamResponse.status,
      bodyText: text,
    });
  }

  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const providerRequestId = readUpstreamRequestId(upstreamResponse.headers);
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
    tryEmitLogicalCompleted(lifecycle, providerRequestId);
    return new Response(text, {
      status: 200,
      headers: headersWithLogicalRequestIdentity(upstreamResponse.headers, route.logicalRequestId, {
        "content-type": contentType || "application/json",
      }),
    });
  }

  const observedBody = observeResponsesSseBody({
    route,
    body: upstreamResponse.body,
    onUsage,
    onLog,
    ...(providerRequestId && { providerRequestId }),
    ...(codexTurnMetadata && { codexTurnMetadata }),
    ...(lifecycle && { lifecycle }),
  });

  return new Response(observedBody, {
    status: 200,
    headers: headersWithLogicalRequestIdentity(upstreamResponse.headers, route.logicalRequestId, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    }),
  });
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

function observeResponsesSseBody(input: {
  route: ResolvedProviderRoute;
  body: ReadableStream<Uint8Array>;
  providerRequestId?: string;
  codexTurnMetadata?: GatewayCodexTurnMetadata;
  onUsage: GatewayUsageObserver | undefined;
  onLog: GatewayLogFn;
  lifecycle?: RequestLifecycleContext;
}): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let usageEmitted = false;
  let streamFailed = false;
  let sawResponseCompleted = false;
  let terminalSettled = false;
  const providerRequestId = input.providerRequestId;
  const reader = input.body.getReader();
  let cancelled = false;

  const closeDownstreamAndCancelUpstream = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (terminalSettled) {
      return;
    }
    terminalSettled = true;
    try {
      controller.close();
    } catch {
      // already closed
    }
    void reader.cancel().catch(() => undefined);
  };

  const failureMessageFromEvent = (event: Record<string, unknown>, type: string): string => {
    const errObj = event.error as { message?: string } | string | undefined;
    const responseObj = event.response as { error?: { message?: string } | string } | undefined;
    const responseError = responseObj?.error;
    return type === "response.incomplete"
      ? "Upstream response incomplete"
      : typeof errObj === "string"
        ? errObj
        : typeof errObj?.message === "string"
          ? errObj.message
          : typeof responseError === "string"
            ? responseError
            : typeof responseError?.message === "string"
              ? responseError.message
              : JSON.stringify(event).slice(0, 400);
  };

  /** Observe one SSE block after it has been enqueued. Returns true when terminal froze the stream. */
  const observeEnqueuedBlock = (
    block: string,
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): boolean => {
    if (terminalSettled || cancelled) {
      return true;
    }
    const event = parseResponsesStreamEventBlock(block);
    if (!event) {
      return false;
    }
    const type = typeof event.type === "string" ? event.type : "unknown";

    if (
      type === "error" ||
      type === "response.failed" ||
      type === "response.incomplete" ||
      (event as { error?: unknown }).error
    ) {
      streamFailed = true;
      reportLogicalUpstreamFailure(input.lifecycle, {
        stage: "stream",
        error: failureMessageFromEvent(event as unknown as Record<string, unknown>, type),
        ...(providerRequestId ? { providerRequestId } : {}),
      });
      closeDownstreamAndCancelUpstream(controller);
      return true;
    }

    if (type === "response.completed") {
      sawResponseCompleted = true;
      if (!usageEmitted && input.onUsage) {
        const usage = extractUsageFromResponsesStreamEvent(event, input.route.upstreamModelId);
        if (usage) {
          usageEmitted = true;
          const response = isRecord(event.response) ? event.response : undefined;
          const responseId = response ? readString(response, "id") : undefined;
          emitGatewayUsage({
            route: input.route,
            usage,
            stream: true,
            ...(responseId && { responseId }),
            ...(providerRequestId && { providerRequestId }),
            ...(input.codexTurnMetadata && { codexTurnMetadata: input.codexTurnMetadata }),
            onUsage: input.onUsage,
            onLog: input.onLog,
          });
        }
      }
      tryEmitLogicalCompleted(input.lifecycle, providerRequestId);
      closeDownstreamAndCancelUpstream(controller);
      return true;
    }

    if (!usageEmitted && input.onUsage) {
      const usage = extractUsageFromResponsesStreamEvent(event, input.route.upstreamModelId);
      if (usage) {
        usageEmitted = true;
        const response = isRecord(event.response) ? event.response : undefined;
        const responseId = response ? readString(response, "id") : undefined;
        emitGatewayUsage({
          route: input.route,
          usage,
          stream: true,
          ...(responseId && { responseId }),
          ...(providerRequestId && { providerRequestId }),
          ...(input.codexTurnMetadata && { codexTurnMetadata: input.codexTurnMetadata }),
          onUsage: input.onUsage,
          onLog: input.onLog,
        });
      }
    }
    return false;
  };

  const enqueueSseBlock = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    block: string,
  ) => {
    const framed = block.endsWith("\n\n") ? block : `${block}\n\n`;
    controller.enqueue(encoder.encode(framed));
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cancelled || terminalSettled) {
        return;
      }
      try {
        const { done, value } = await reader.read();
        if (cancelled || terminalSettled) {
          return;
        }
        if (done) {
          buffer += decoder.decode();
          if (buffer.trim()) {
            const { blocks } = splitSseBlocks(`${buffer}\n\n`);
            for (const block of blocks) {
              enqueueSseBlock(controller, block);
              if (observeEnqueuedBlock(block, controller)) {
                return;
              }
            }
          }
          if (cancelled || terminalSettled) {
            return;
          }
          if (!streamFailed && !sawResponseCompleted) {
            streamFailed = true;
            const message = "Upstream Responses stream ended before response.completed.";
            reportLogicalUpstreamFailure(input.lifecycle, {
              stage: "stream",
              error: message,
              ...(providerRequestId ? { providerRequestId } : {}),
            });
            try {
              controller.enqueue(encoder.encode(responsesFailedSse(message)));
            } catch {
              // downstream already closed
            }
          }
          closeDownstreamAndCancelUpstream(controller);
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const { blocks, remainder } = splitSseBlocks(buffer);
        buffer = remainder;
        for (const block of blocks) {
          enqueueSseBlock(controller, block);
          if (observeEnqueuedBlock(block, controller)) {
            return;
          }
        }
      } catch (error) {
        if (cancelled || terminalSettled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        reportLogicalUpstreamFailure(input.lifecycle, {
          stage: "stream",
          error: `reader failure: ${message}`,
          ...(providerRequestId ? { providerRequestId } : {}),
        });
        try {
          controller.error(error);
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      cancelled = true;
      tryEmitLogicalCancelled(input.lifecycle, {
        reason: "downstream cancel",
        ...(providerRequestId ? { providerRequestId } : {}),
      });
      reader.cancel().catch(() => {});
    },
  });
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
  return ["responses", input.route.provider.id, input.route.requestedModel, Date.now(), usageEventSeq].join(
    ":",
  );
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
