import {
  anthropicEventToResponsesEvents,
  anthropicToResponsesResponse,
  finalizeAnthropicResponsesStream,
  newAnthropicEventToResponsesState,
  responsesEventToSse,
  responsesToAnthropicRequest,
  type AnthropicRequest,
  type AnthropicResponse,
  type AnthropicStreamEvent,
  type ResponsesRequest,
} from "@eco/openai-anthropic-bridge";
import { buildUpstreamUrl } from "../provider-router.js";
import type {
  GatewayCodexTurnMetadata,
  GatewayUsageEvent,
  GatewayUsageObserver,
  ResolvedProviderRoute,
} from "../types.js";
import { normalizeAnthropicUsage, type ParsedUsage } from "../usage-normalize.js";
import {
  appendStreamUtf8Chunk,
  createStreamUtf8Decoder,
  finalizeStreamUtf8Decoder,
  parseAnthropicStreamEventBlock,
  splitSseBlocks,
} from "../sse.js";
import type { GatewayLogFn } from "../server.js";
import { responsesFailedSse } from "./responses-stream-errors.js";
import {
  rectifyThinkingBudget,
  shouldRectifyThinkingBudget,
} from "./thinking-budget-rectifier.js";
import {
  rectifyAnthropicRequest,
  shouldRectifyThinkingSignature,
} from "./thinking-rectifier.js";
import {
  extractUpstreamErrorMessage,
  upstreamErrorResponse,
} from "./upstream-error.js";

const ANTHROPIC_VERSION = "2023-06-01";

type AnthropicUsageRejectionReason =
  | "duplicate_message_start"
  | "invalid_message_start"
  | "invalid_message_start_usage"
  | "message_delta_before_start"
  | "invalid_message_delta_usage"
  | "non_monotonic_message_delta_usage"
  | "missing_message_start"
  | "missing_message_delta_usage"
  | "missing_message_stop"
  | "missing_response_body"
  | "missing_response_identity"
  | "invalid_non_stream_response"
  | "invalid_non_stream_usage";

interface AnthropicStreamUsageTracker {
  started: boolean;
  stopped: boolean;
  finalUsageSeen: boolean;
  responseId?: string;
  usage?: ParsedUsage;
  rejectionReason?: AnthropicUsageRejectionReason;
}

function buildAnthropicUpstreamHeaders(
  providerApiKey: string,
  clientHeaders: Headers,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": providerApiKey,
    "anthropic-version": clientHeaders.get("anthropic-version") ?? ANTHROPIC_VERSION,
  };
  const beta = clientHeaders.get("anthropic-beta");
  if (beta) {
    headers["anthropic-beta"] = beta;
  }
  const accept = clientHeaders.get("accept");
  if (accept) {
    headers.accept = accept;
  }
  return headers;
}

async function postAnthropic(
  upstreamUrl: string,
  headers: Record<string, string>,
  body: AnthropicRequest,
  fetchImpl: typeof fetch,
): Promise<Response> {
  return fetchImpl(upstreamUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function cloneAnthropicBody(body: AnthropicRequest): Record<string, unknown> {
  return JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
}

function asAnthropicRequest(body: Record<string, unknown>): AnthropicRequest {
  return body as unknown as AnthropicRequest;
}

/**
 * On signature/budget validation errors, rectify the Anthropic request and retry once
 * (CC thinking_rectifier / thinking_budget_rectifier).
 */
async function fetchWithThinkingRectifiers(
  route: ResolvedProviderRoute,
  upstreamUrl: string,
  upstreamHeaders: Record<string, string>,
  anthropicBody: AnthropicRequest,
  fetchImpl: typeof fetch,
  onLog: GatewayLogFn,
): Promise<Response> {
  let upstreamResponse: Response;
  try {
    upstreamResponse = await postAnthropic(
      upstreamUrl,
      upstreamHeaders,
      anthropicBody,
      fetchImpl,
    );
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

  if (upstreamResponse.ok) {
    return upstreamResponse;
  }

  const text = await upstreamResponse.text();
  onLog(`upstream error body: ${text.slice(0, 300)}`);
  const errorMessage = extractUpstreamErrorMessage(text);

  if (shouldRectifyThinkingSignature(errorMessage)) {
    const rectified = cloneAnthropicBody(anthropicBody);
    const result = rectifyAnthropicRequest(rectified);
    if (result.applied) {
      onLog(
        `[eco-gateway] [RECT-001] thinking signature rectifier applied, removed ${result.removedThinkingBlocks} thinking, ${result.removedRedactedThinkingBlocks} redacted_thinking, ${result.removedSignatureFields} signature fields`,
      );
      try {
        const retryResponse = await postAnthropic(
          upstreamUrl,
          upstreamHeaders,
          asAnthropicRequest(rectified),
          fetchImpl,
        );
        if (retryResponse.ok) {
          onLog(`[eco-gateway] [RECT-002] thinking signature rectifier retry succeeded`);
          return retryResponse;
        }
        const retryText = await retryResponse.text();
        onLog(
          `[eco-gateway] [RECT-003] thinking signature rectifier retry still failed: ${retryText.slice(0, 300)}`,
        );
        return upstreamErrorResponse({
          route,
          upstreamUrl,
          status: retryResponse.status,
          bodyText: retryText,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onLog(`[eco-gateway] [RECT-003] thinking signature rectifier retry still failed: ${message}`);
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
    }
    onLog(
      `[eco-gateway] [RECT-006] thinking signature rectifier triggered but nothing to rectify; checking budget`,
    );
  }

  if (shouldRectifyThinkingBudget(errorMessage)) {
    const rectified = cloneAnthropicBody(anthropicBody);
    const result = rectifyThinkingBudget(rectified);
    if (result.applied) {
      onLog(
        `[eco-gateway] [RECT-010] thinking budget rectifier applied, before=${JSON.stringify(result.before)}, after=${JSON.stringify(result.after)}`,
      );
      try {
        const retryResponse = await postAnthropic(
          upstreamUrl,
          upstreamHeaders,
          asAnthropicRequest(rectified),
          fetchImpl,
        );
        if (retryResponse.ok) {
          onLog(`[eco-gateway] [RECT-011] thinking budget rectifier retry succeeded`);
          return retryResponse;
        }
        const retryText = await retryResponse.text();
        onLog(
          `[eco-gateway] [RECT-012] thinking budget rectifier retry still failed: ${retryText.slice(0, 300)}`,
        );
        return upstreamErrorResponse({
          route,
          upstreamUrl,
          status: retryResponse.status,
          bodyText: retryText,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onLog(`[eco-gateway] [RECT-012] thinking budget rectifier retry still failed: ${message}`);
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
    }
    onLog(
      `[eco-gateway] [RECT-014] thinking budget rectifier triggered but nothing to rectify`,
    );
  }

  return upstreamErrorResponse({
    route,
    upstreamUrl,
    status: upstreamResponse.status,
    bodyText: text,
  });
}

export async function forwardAnthropicMessages(
  route: ResolvedProviderRoute,
  responsesBody: ResponsesRequest,
  clientHeaders: Headers,
  fetchImpl: typeof fetch = fetch,
  onLog: GatewayLogFn = () => undefined,
  onUsage?: GatewayUsageObserver,
  codexTurnMetadata?: GatewayCodexTurnMetadata,
): Promise<Response> {
  const anthropicBody = responsesToAnthropicRequest(responsesBody);
  anthropicBody.model = route.upstreamModelId;
  return forwardAnthropicMessagesBody(
    route,
    anthropicBody,
    clientHeaders,
    fetchImpl,
    onLog,
    onUsage,
    codexTurnMetadata,
  );
}

/** Forward a pre-built Anthropic Messages body (used by rectifier tests). */
export async function forwardAnthropicMessagesBody(
  route: ResolvedProviderRoute,
  anthropicBody: AnthropicRequest,
  clientHeaders: Headers,
  fetchImpl: typeof fetch = fetch,
  onLog: GatewayLogFn = () => undefined,
  onUsage?: GatewayUsageObserver,
  codexTurnMetadata?: GatewayCodexTurnMetadata,
): Promise<Response> {
  const upstreamUrl = buildUpstreamUrl(route.provider, "anthropic-messages");
  const upstreamHeaders = buildAnthropicUpstreamHeaders(route.provider.apiKey, clientHeaders);
  const payload = JSON.stringify(anthropicBody);
  onLog(
    `upstream POST ${upstreamUrl} provider=${route.provider.id} model=${route.upstreamModelId} bytes=${payload.length}`,
  );

  const upstreamResponse = await fetchWithThinkingRectifiers(
    route,
    upstreamUrl,
    upstreamHeaders,
    anthropicBody,
    fetchImpl,
    onLog,
  );

  // Error responses from rectifier path are already formatted.
  if (!upstreamResponse.ok) {
    onLog(`upstream response ${upstreamUrl} status=${upstreamResponse.status}`);
    return upstreamResponse;
  }

  onLog(`upstream response ${upstreamUrl} status=${upstreamResponse.status}`);

  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const isEventStream = contentType.includes("text/event-stream");
  const providerRequestId = readProviderRequestId(upstreamResponse.headers);

  if (!isEventStream) {
    const text = await upstreamResponse.text();
    try {
      const anthropicMessage = JSON.parse(text) as AnthropicResponse;
      const responsesJson = anthropicToResponsesResponse(anthropicMessage);
      const responseId = readNonEmptyString(anthropicMessage.id);
      const responseModelId = readNonEmptyString(anthropicMessage.model);
      const usage = responseModelId
        ? normalizeAnthropicUsage(anthropicMessage.usage, responseModelId)
        : null;
      if (!usage) {
        logAnthropicUsageRejection(route, false, "invalid_non_stream_usage", onUsage, onLog);
      } else if (!responseId) {
        logAnthropicUsageRejection(route, false, "missing_response_identity", onUsage, onLog);
      } else {
        emitAnthropicGatewayUsage({
          route,
          usage,
          stream: false,
          responseId,
          ...(providerRequestId && { providerRequestId }),
          ...(codexTurnMetadata && { codexTurnMetadata }),
          onUsage,
          onLog,
        });
      }
      return Response.json(responsesJson, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch {
      logAnthropicUsageRejection(route, false, "invalid_non_stream_response", onUsage, onLog);
      return Response.json(
        { error: { message: "Unable to parse Anthropic upstream response." } },
        { status: 502 },
      );
    }
  }

  if (!upstreamResponse.body) {
    logAnthropicUsageRejection(route, true, "missing_response_body", onUsage, onLog);
    return upstreamErrorResponse({
      route,
      upstreamUrl,
      status: 502,
      bodyText: "Anthropic upstream returned a successful response without a body.",
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const state = newAnthropicEventToResponsesState();
      const usageTracker = newAnthropicStreamUsageTracker();
      let sseBuffer = "";
      const utf8Decoder = createStreamUtf8Decoder();
      let usageOutcomeSettled = false;

      const settleUsage = () => {
        if (usageOutcomeSettled) {
          return;
        }
        usageOutcomeSettled = true;
        const outcome = resolveAnthropicStreamUsage(usageTracker);
        if (outcome.status === "rejected") {
          logAnthropicUsageRejection(route, true, outcome.reason, onUsage, onLog);
          return;
        }
        emitAnthropicGatewayUsage({
          route,
          usage: outcome.usage,
          stream: true,
          responseId: outcome.responseId,
          ...(providerRequestId && { providerRequestId }),
          ...(codexTurnMetadata && { codexTurnMetadata }),
          onUsage,
          onLog,
        });
      };

      const writeResponsesEvents = (
        events: ReturnType<typeof anthropicEventToResponsesEvents>,
      ) => {
        for (const evt of events) {
          controller.enqueue(encoder.encode(responsesEventToSse(evt)));
        }
      };

      try {
        for await (const chunk of upstreamResponse.body as AsyncIterable<Uint8Array>) {
          sseBuffer = appendStreamUtf8Chunk(utf8Decoder, sseBuffer, chunk);
          const { blocks, remainder } = splitSseBlocks(sseBuffer);
          sseBuffer = remainder;
          for (const block of blocks) {
            const anthropicEvent = parseAnthropicStreamEventBlock(block);
            if (!anthropicEvent) {
              continue;
            }
            const responsesEvents = anthropicEventToResponsesEvents(anthropicEvent, state);
            trackAnthropicStreamUsage(usageTracker, anthropicEvent);
            writeResponsesEvents(responsesEvents);
            if (anthropicEvent.type === "message_stop") {
              settleUsage();
            }
          }
        }

        sseBuffer = finalizeStreamUtf8Decoder(utf8Decoder, sseBuffer);
        if (sseBuffer.trim()) {
          const { blocks } = splitSseBlocks(`${sseBuffer}\n\n`);
          for (const block of blocks) {
            const anthropicEvent = parseAnthropicStreamEventBlock(block);
            if (anthropicEvent) {
              const responsesEvents = anthropicEventToResponsesEvents(anthropicEvent, state);
              trackAnthropicStreamUsage(usageTracker, anthropicEvent);
              writeResponsesEvents(responsesEvents);
              if (anthropicEvent.type === "message_stop") {
                settleUsage();
              }
            }
          }
        }

        writeResponsesEvents(finalizeAnthropicResponsesStream(state));
        settleUsage();
      } catch (error) {
        settleUsage();
        const message = error instanceof Error ? error.message : String(error);
        controller.enqueue(encoder.encode(responsesFailedSse(message)));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

function newAnthropicStreamUsageTracker(): AnthropicStreamUsageTracker {
  return {
    started: false,
    stopped: false,
    finalUsageSeen: false,
  };
}

function trackAnthropicStreamUsage(
  tracker: AnthropicStreamUsageTracker,
  event: AnthropicStreamEvent,
): void {
  if (tracker.rejectionReason) {
    if (event.type === "message_stop") {
      tracker.stopped = true;
    }
    return;
  }

  if (event.type === "message_start") {
    if (tracker.started) {
      tracker.rejectionReason = "duplicate_message_start";
      return;
    }
    tracker.started = true;
    const message = event.message;
    if (!message || typeof message !== "object") {
      tracker.rejectionReason = "invalid_message_start";
      return;
    }
    const modelId = readNonEmptyString(message.model);
    const responseId = readNonEmptyString(message.id);
    if (!modelId || !responseId) {
      tracker.rejectionReason = "invalid_message_start";
      return;
    }
    const usage = normalizeAnthropicUsage(message.usage, modelId);
    if (!usage) {
      tracker.rejectionReason = "invalid_message_start_usage";
      return;
    }
    tracker.responseId = responseId;
    tracker.usage = usage;
    return;
  }

  if (event.type === "message_delta") {
    if (!tracker.started || !tracker.usage) {
      tracker.rejectionReason = "message_delta_before_start";
      return;
    }
    const delta = parseAnthropicMessageDeltaUsage(event.usage);
    if (!delta) {
      tracker.rejectionReason = "invalid_message_delta_usage";
      return;
    }
    if (
      delta.outputTokens < tracker.usage.outputTokens ||
      (delta.inputTokens !== undefined && delta.inputTokens < tracker.usage.inputTokens) ||
      (delta.cacheReadTokens !== undefined &&
        delta.cacheReadTokens < tracker.usage.cacheReadTokens) ||
      (delta.cacheCreationTokens !== undefined &&
        delta.cacheCreationTokens < tracker.usage.cacheCreationTokens)
    ) {
      tracker.rejectionReason = "non_monotonic_message_delta_usage";
      return;
    }
    tracker.usage = {
      ...tracker.usage,
      outputTokens: delta.outputTokens,
      ...(delta.inputTokens !== undefined && { inputTokens: delta.inputTokens }),
      ...(delta.cacheReadTokens !== undefined && { cacheReadTokens: delta.cacheReadTokens }),
      ...(delta.cacheCreationTokens !== undefined && {
        cacheCreationTokens: delta.cacheCreationTokens,
      }),
    };
    tracker.finalUsageSeen = true;
    return;
  }

  if (event.type === "message_stop") {
    tracker.stopped = true;
  }
}

function parseAnthropicMessageDeltaUsage(usage: unknown): {
  outputTokens: number;
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
} | null {
  if (!isRecord(usage)) {
    return null;
  }
  const outputTokens = readExactNonNegativeInteger(usage.output_tokens);
  if (outputTokens === undefined) {
    return null;
  }
  const inputTokens = readOptionalCumulativeTokenCount(usage, "input_tokens");
  const cacheReadTokens = readOptionalCumulativeTokenCount(
    usage,
    "cache_read_input_tokens",
  );
  const cacheCreationTokens = readOptionalCumulativeTokenCount(
    usage,
    "cache_creation_input_tokens",
  );
  if (!inputTokens.valid || !cacheReadTokens.valid || !cacheCreationTokens.valid) {
    return null;
  }
  return {
    outputTokens,
    ...(inputTokens.value !== undefined && { inputTokens: inputTokens.value }),
    ...(cacheReadTokens.value !== undefined && { cacheReadTokens: cacheReadTokens.value }),
    ...(cacheCreationTokens.value !== undefined && {
      cacheCreationTokens: cacheCreationTokens.value,
    }),
  };
}

function readOptionalCumulativeTokenCount(
  usage: Record<string, unknown>,
  key: string,
): { valid: true; value?: number } | { valid: false } {
  if (!Object.hasOwn(usage, key) || usage[key] === null) {
    return { valid: true };
  }
  const value = readExactNonNegativeInteger(usage[key]);
  return value === undefined ? { valid: false } : { valid: true, value };
}

function readExactNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function resolveAnthropicStreamUsage(
  tracker: AnthropicStreamUsageTracker,
):
  | { status: "resolved"; usage: ParsedUsage; responseId: string }
  | { status: "rejected"; reason: AnthropicUsageRejectionReason } {
  if (tracker.rejectionReason) {
    return { status: "rejected", reason: tracker.rejectionReason };
  }
  if (!tracker.started || !tracker.usage) {
    return { status: "rejected", reason: "missing_message_start" };
  }
  if (!tracker.finalUsageSeen) {
    return { status: "rejected", reason: "missing_message_delta_usage" };
  }
  if (!tracker.stopped) {
    return { status: "rejected", reason: "missing_message_stop" };
  }
  if (!tracker.responseId) {
    return { status: "rejected", reason: "missing_response_identity" };
  }
  return {
    status: "resolved",
    usage: tracker.usage,
    responseId: tracker.responseId,
  };
}

function emitAnthropicGatewayUsage(input: {
  route: ResolvedProviderRoute;
  usage: ParsedUsage;
  stream: boolean;
  responseId: string;
  providerRequestId?: string;
  codexTurnMetadata?: GatewayCodexTurnMetadata;
  onUsage: GatewayUsageObserver | undefined;
  onLog: GatewayLogFn;
}): void {
  if (!input.onUsage) {
    return;
  }
  const sourceEventId = `anthropic:${input.route.provider.id}:response:${input.responseId}`;
  const event: GatewayUsageEvent = {
    source: "responses",
    sourceEventId,
    providerId: input.route.provider.id,
    requestedModel: input.route.requestedModel,
    upstreamModelId: input.route.upstreamModelId,
    usage: input.usage,
    stream: input.stream,
    observedAt: new Date().toISOString(),
    responseId: input.responseId,
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

function logAnthropicUsageRejection(
  route: ResolvedProviderRoute,
  stream: boolean,
  reason: AnthropicUsageRejectionReason,
  onUsage: GatewayUsageObserver | undefined,
  onLog: GatewayLogFn,
): void {
  if (!onUsage) {
    return;
  }
  onLog(
    `anthropic usage rejected provider=${route.provider.id} model=${route.upstreamModelId} stream=${stream} reason=${reason}; usage will not be billed`,
  );
}

function readProviderRequestId(headers: Headers): string | undefined {
  return (
    headers.get("request-id")?.trim() ||
    headers.get("x-request-id")?.trim() ||
    headers.get("anthropic-request-id")?.trim() ||
    undefined
  );
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
