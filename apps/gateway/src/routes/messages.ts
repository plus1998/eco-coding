/**
 * Anthropic Messages client face for @eco/gateway.
 * Bridge injects x-gateway-provider-id + concrete model before calling gateway.
 */
import {
  anthropicToResponses,
  extractAnthropicRequestToolNames,
  responsesEventToAnthropicEvents,
  responsesToAnthropic,
  type AnthropicRequest,
  type ResponsesRequest,
  type ResponsesStreamEvent,
  newResponsesEventToAnthropicState,
  finalizeResponsesAnthropicStream,
  responsesAnthropicEventToSse,
} from "@eco/openai-anthropic-bridge";
import {
  MissingProviderIdError,
  ProviderNotFoundError,
  UnsupportedUpstreamKindError,
  IncompatibleUpstreamKindError,
  applyGatewayResponsesPromptCacheHints,
  buildUpstreamCountTokensUrl,
  buildUpstreamUrl,
  readProviderIdFromHeaders,
  readRequestedModelFromHeaders,
  readThreadIdFromHeaders,
  readUpstreamKindFromHeaders,
  resolveProviderRoute,
} from "../provider-router.js";
import type { GatewayLogFn } from "../server.js";
import type {
  GatewayConfig,
  GatewayUsageEvent,
  GatewayUsageObserver,
  ResolvedProviderRoute,
} from "../types.js";
import { applyUpstreamUserAgent } from "../upstream/user-agent.js";
import {
  extractUsageFromResponsesStreamEvent,
  normalizeAnthropicUsage,
  normalizeResponsesUsage,
  type ParsedUsage,
} from "../usage-normalize.js";
import {
  appendStreamUtf8Chunk,
  createStreamUtf8Decoder,
  finalizeStreamUtf8Decoder,
  parseAnthropicStreamEventBlock,
  parseResponsesStreamEventBlock,
  splitSseBlocks,
} from "../sse.js";
import {
  newAnthropicStreamUsageTracker,
  resolveAnthropicStreamUsage,
  trackAnthropicStreamUsage,
  type AnthropicStreamUsageTracker,
} from "../anthropic-stream-usage.js";
import { forwardOpenAIChat } from "../upstream/openai-chat.js";
import {
  isDeepSeekResponsesUpstreamModel,
  sanitizeDeepSeekResponsesCustomTools,
} from "../upstream/responses-passthrough.js";
import {
  extractUpstreamErrorMessage,
  formatUpstreamHttpError,
} from "../upstream/upstream-error.js";

const ANTHROPIC_VERSION = "2023-06-01";

/** Top-level Responses fields some OpenAI-compat hosts reject (DeepSeek/etc.). */
const DROPPABLE_RESPONSES_PARAMS = new Set([
  "cache_control",
  "context_management",
  "include",
  "parallel_tool_calls",
  "store",
  "text",
  "service_tier",
  "prompt_cache_key",
  "prompt_cache_retention",
  "previous_response_id",
  "temperature",
  "top_p",
  "reasoning",
]);

const MAX_UNSUPPORTED_PARAM_DROPS = 8;

/** Abort hang when upstream SSE sends headers but never emits a framed event. */
const RESPONSES_STREAM_FIRST_EVENT_TIMEOUT_MS = 45_000;

export async function handlePostMessages(
  request: Request,
  config: GatewayConfig,
  fetchImpl: typeof fetch = fetch,
  onLog: GatewayLogFn = () => undefined,
  onUsage?: GatewayUsageObserver,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const requestedModel =
    typeof body.model === "string" ? body.model.trim() : "(missing model)";

  let route: ResolvedProviderRoute;
  try {
    route = resolveProviderRoute(body.model as string | undefined, config.providers, {
      providerId: readProviderIdFromHeaders(request.headers),
      upstreamKindOverride: readUpstreamKindFromHeaders(request.headers),
      requestedModel: readRequestedModelFromHeaders(request.headers),
    });
  } catch (error) {
    if (
      error instanceof ProviderNotFoundError ||
      error instanceof MissingProviderIdError ||
      error instanceof UnsupportedUpstreamKindError ||
      error instanceof IncompatibleUpstreamKindError
    ) {
      return Response.json({ error: { message: error.message } }, { status: error.status });
    }
    throw error;
  }

  body.model = route.upstreamModelId;
  const stream = body.stream === true;
  const upstreamUrl = buildUpstreamUrl(route.provider, route.upstreamKind);
  onLog(
    `POST /v1/messages provider=${route.provider.id} kind=${route.upstreamKind} model=${route.upstreamModelId} stream=${stream}`,
  );

  switch (route.upstreamKind) {
    case "anthropic-messages":
      return forwardMessagesNative(
        route,
        body,
        request.headers,
        upstreamUrl,
        fetchImpl,
        onLog,
        onUsage,
        config.upstreamUserAgent,
      );
    case "responses":
    case "gateway-delegated":
      return forwardMessagesViaResponses(
        route,
        body,
        request.headers,
        upstreamUrl,
        fetchImpl,
        onLog,
        onUsage,
        config.upstreamUserAgent,
      );
    case "openai-chat":
      return forwardMessagesViaOpenAIChat(
        route,
        body,
        request.headers,
        fetchImpl,
        onLog,
        onUsage,
        config.upstreamUserAgent,
      );
    default: {
      const _exhaustive: never = route.upstreamKind;
      return _exhaustive;
    }
  }
}

export async function handleGetModels(config: GatewayConfig): Promise<Response> {
  const data = config.providers.flatMap((provider) =>
    provider.models.map((model) => ({
      id: model,
      object: "model",
      created: 0,
      owned_by: provider.id,
    })),
  );
  return Response.json({ object: "list", data });
}

export async function handlePostMessagesCountTokens(
  request: Request,
  config: GatewayConfig,
  fetchImpl: typeof fetch = fetch,
  onLog: GatewayLogFn = () => undefined,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  let route: ResolvedProviderRoute;
  try {
    route = resolveProviderRoute(body.model as string | undefined, config.providers, {
      providerId: readProviderIdFromHeaders(request.headers),
      upstreamKindOverride: readUpstreamKindFromHeaders(request.headers),
      requestedModel: readRequestedModelFromHeaders(request.headers),
    });
  } catch (error) {
    if (
      error instanceof ProviderNotFoundError ||
      error instanceof MissingProviderIdError ||
      error instanceof UnsupportedUpstreamKindError ||
      error instanceof IncompatibleUpstreamKindError
    ) {
      return Response.json({ error: { message: error.message } }, { status: error.status });
    }
    throw error;
  }

  if (route.upstreamKind !== "anthropic-messages") {
    onLog(
      `count_tokens unsupported for kind=${route.upstreamKind}; missing exact token count`,
    );
    return Response.json(
      {
        error: {
          message: `count_tokens only supported for anthropic-messages upstream (got ${route.upstreamKind})`,
        },
      },
      { status: 501 },
    );
  }

  body.model = route.upstreamModelId;
  const upstreamUrl = buildUpstreamCountTokensUrl(route.provider);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": route.provider.apiKey,
    "anthropic-version": request.headers.get("anthropic-version") ?? ANTHROPIC_VERSION,
  };
  applyUpstreamUserAgent(headers, request.headers, config.upstreamUserAgent);
  try {
    return await fetchImpl(upstreamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: { message } }, { status: 502 });
  }
}

async function forwardMessagesViaOpenAIChat(
  route: ResolvedProviderRoute,
  body: Record<string, unknown>,
  clientHeaders: Headers,
  fetchImpl: typeof fetch,
  onLog: GatewayLogFn,
  onUsage: GatewayUsageObserver | undefined,
  upstreamUserAgent: string | undefined,
): Promise<Response> {
  const anthropicBody = {
    ...body,
    model: route.upstreamModelId,
  } as unknown as AnthropicRequest;
  const requestToolNames = extractAnthropicRequestToolNames(anthropicBody);
  const responsesBody = anthropicToResponses(anthropicBody) as ResponsesRequest;
  responsesBody.model = route.upstreamModelId;
  applyGatewayResponsesPromptCacheHints(responsesBody as unknown as Record<string, unknown>, {
    providerBaseUrl: route.provider.baseUrl,
    ...(readThreadIdFromHeaders(clientHeaders)
      ? { threadId: readThreadIdFromHeaders(clientHeaders) }
      : {}),
  });
  const wantStream = body.stream === true;
  const startedAt = Date.now();

  // Reuse Responses→Chat conversion but bill only via Messages face (source=messages).
  // Passing onUsage into forwardOpenAIChat would emit source=responses without codex turn metadata.
  const responsesResponse = await forwardOpenAIChat(
    route,
    responsesBody,
    clientHeaders,
    fetchImpl,
    onLog,
    undefined,
    undefined,
    upstreamUserAgent,
  );

  if (!responsesResponse.ok) {
    const text = await responsesResponse.text();
    const message =
      extractUpstreamErrorMessage(text) ||
      `Upstream chat conversion failed (${responsesResponse.status})`;
    onLog(`messages→chat upstream error status=${responsesResponse.status}: ${message.slice(0, 300)}`);
    if (wantStream) {
      return anthropicErrorSseResponse(responsesResponse.status, message);
    }
    return anthropicErrorResponse(responsesResponse.status, message);
  }

  if (!wantStream) {
    const json = (await responsesResponse.json()) as Parameters<typeof responsesToAnthropic>[0];
    const anthropic = responsesToAnthropic(json);
    if (onUsage) {
      const usage =
        normalizeAnthropicUsage(
          (anthropic as { usage?: unknown }).usage,
          route.upstreamModelId,
        ) ??
        normalizeResponsesUsage(
          (json as { usage?: never }).usage,
          route.upstreamModelId,
        );
      if (usage) {
        emitMessagesUsage(
          onUsage,
          route,
          usage,
          false,
          (anthropic as { id?: string }).id ?? (json as { id?: string }).id,
          onLog,
        );
      }
    }
    return Response.json(anthropic, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  if (!responsesResponse.body) {
    return anthropicErrorSseResponse(502, "Empty stream body after chat conversion");
  }

  // Same Responses SSE → Anthropic path as messages→responses (eager pump + tool names).
  return mapResponsesSseBodyToAnthropic({
    upstreamBody: responsesResponse.body,
    requestToolNames,
    providerId: route.provider.id,
    startedAt,
    onLog,
    faceLabel: "messages→chat",
    route,
    onUsage,
  });
}

async function forwardMessagesNative(
  route: ResolvedProviderRoute,
  body: Record<string, unknown>,
  clientHeaders: Headers,
  upstreamUrl: string,
  fetchImpl: typeof fetch,
  onLog: GatewayLogFn,
  onUsage: GatewayUsageObserver | undefined,
  upstreamUserAgent: string | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": route.provider.apiKey,
    "anthropic-version": clientHeaders.get("anthropic-version") ?? ANTHROPIC_VERSION,
  };
  const beta = clientHeaders.get("anthropic-beta");
  if (beta) headers["anthropic-beta"] = beta;
  applyUpstreamUserAgent(headers, clientHeaders, upstreamUserAgent);

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetchImpl(upstreamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onLog(`messages native upstream failed: ${message}`);
    return Response.json({ error: { message } }, { status: 502 });
  }

  if (!upstreamResponse.ok || body.stream !== true) {
    if (onUsage && upstreamResponse.ok) {
      try {
        const cloned = upstreamResponse.clone();
        const json = (await cloned.json()) as { usage?: unknown; id?: string };
        const usage = normalizeAnthropicUsage(json.usage as never, route.upstreamModelId);
        if (usage) {
          emitMessagesUsage(onUsage, route, usage, false, json.id, onLog);
        }
      } catch {
        // ignore usage parse
      }
    }
    return upstreamResponse;
  }

  // Stream: pass through bytes while observing message_start/delta/stop usage for billing.
  return passThroughAnthropicSseWithUsage(upstreamResponse, route, onUsage, onLog);
}

async function forwardMessagesViaResponses(
  route: ResolvedProviderRoute,
  body: Record<string, unknown>,
  clientHeaders: Headers,
  upstreamUrl: string,
  fetchImpl: typeof fetch,
  onLog: GatewayLogFn,
  onUsage: GatewayUsageObserver | undefined,
  upstreamUserAgent: string | undefined,
): Promise<Response> {
  const anthropicBody = {
    ...body,
    model: route.upstreamModelId,
  } as unknown as AnthropicRequest;
  const requestToolNames = extractAnthropicRequestToolNames(anthropicBody);
  let responsesBody = sanitizeDeepSeekResponsesCustomTools(
    anthropicToResponses(anthropicBody) as ResponsesRequest,
    route.upstreamModelId,
  );
  responsesBody.model = route.upstreamModelId;

  // PI/Claude Messages face never passes through desktop applyResponsesRoutingHints.
  // Inject the same eco_thread_* key so Responses prefix cache can stick across tool turns.
  const promptCacheKey = applyGatewayResponsesPromptCacheHints(
    responsesBody as unknown as Record<string, unknown>,
    {
      providerBaseUrl: route.provider.baseUrl,
      ...(readThreadIdFromHeaders(clientHeaders)
        ? { threadId: readThreadIdFromHeaders(clientHeaders) }
        : {}),
    },
  );
  if (promptCacheKey) {
    onLog(`messages→responses prompt_cache_key=${promptCacheKey}`);
  }

  // Preempt soft-fail fields that DeepSeek (and peers) often accept in headers but
  // stall on encrypted-content / verbosity while streaming.
  if (isDeepSeekResponsesUpstreamModel(route.upstreamModelId)) {
    const rec = responsesBody as unknown as Record<string, unknown>;
    for (const key of ["include", "store", "parallel_tool_calls"] as const) {
      if (key in rec) {
        delete rec[key];
      }
    }
    if (rec.text && typeof rec.text === "object") {
      // Keep json_schema formats if present; drop style-only verbosity.
      const text = rec.text as Record<string, unknown>;
      if (text.format === undefined && text.verbosity !== undefined) {
        delete rec.text;
      }
    }
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
    authorization: `Bearer ${route.provider.apiKey}`,
  };
  applyUpstreamUserAgent(headers, clientHeaders, upstreamUserAgent);

  const wantStream = body.stream === true;
  const startedAt = Date.now();
  let upstreamResponse: Response;
  let droppedParams: string[] = [];
  try {
    const posted = await postResponsesWithUnsupportedParamRetry({
      fetchImpl,
      url: upstreamUrl,
      headers,
      body: responsesBody as unknown as Record<string, unknown>,
      onLog,
      route,
    });
    upstreamResponse = posted.response;
    responsesBody = posted.body as unknown as ResponsesRequest;
    droppedParams = posted.droppedParams;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onLog(`messages→responses upstream failed: ${message}`);
    return anthropicErrorResponse(502, message);
  }

  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  onLog(
    `messages→responses upstream status=${upstreamResponse.status} ct=${contentType} stream=${wantStream} tools=${requestToolNames.length} dropped=${droppedParams.join(",") || "(none)"} ttfb=${Date.now() - startedAt}ms`,
  );

  if (!upstreamResponse.ok) {
    const text = await upstreamResponse.text();
    onLog(`messages→responses error body: ${text.slice(0, 300)}`);
    const detailed = formatUpstreamHttpError({
      route,
      upstreamUrl,
      status: upstreamResponse.status,
      bodyText: text,
    });
    if (wantStream) {
      return anthropicErrorSseResponse(upstreamResponse.status, detailed);
    }
    return anthropicErrorResponse(upstreamResponse.status, detailed);
  }

  // Stream requested but upstream replied with JSON (or missing body): convert non-SSE.
  if (wantStream && (!contentType.includes("text/event-stream") || !upstreamResponse.body)) {
    const text = await upstreamResponse.text();
    onLog(
      `messages→responses non-SSE while stream=true len=${text.length} head=${text.slice(0, 120).replace(/\s+/g, " ")}`,
    );
    try {
      const json = JSON.parse(text) as Parameters<typeof responsesToAnthropic>[0];
      const anthropic = responsesToAnthropic(json);
      if (onUsage) {
        const usage =
          normalizeAnthropicUsage(
            (anthropic as { usage?: unknown }).usage,
            route.upstreamModelId,
          ) ??
          normalizeResponsesUsage(
            (json as { usage?: never }).usage,
            route.upstreamModelId,
          );
        if (usage) {
          emitMessagesUsage(
            onUsage,
            route,
            usage,
            true,
            (anthropic as { id?: string }).id ?? (json as { id?: string }).id,
            onLog,
          );
        }
      }
      // Flatten non-stream result into a minimal Anthropic SSE so the Claude SDK keeps the stream path.
      return anthropicJsonAsSse(anthropic);
    } catch {
      return anthropicErrorSseResponse(
        502,
        `Upstream returned non-SSE body for stream request: ${extractUpstreamErrorMessage(text)}`,
      );
    }
  }

  if (!wantStream) {
    const json = (await upstreamResponse.json()) as Parameters<typeof responsesToAnthropic>[0];
    const anthropic = responsesToAnthropic(json);
    if (onUsage) {
      const usage = normalizeResponsesUsage(
        (json as { usage?: never }).usage,
        route.upstreamModelId,
      );
      if (usage) {
        emitMessagesUsage(
          onUsage,
          route,
          usage,
          false,
          (json as { id?: string }).id,
          onLog,
        );
      }
    }
    return Response.json(anthropic, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  if (!upstreamResponse.body) {
    return anthropicErrorSseResponse(502, "Empty stream body");
  }

  return mapResponsesSseBodyToAnthropic({
    upstreamBody: upstreamResponse.body,
    requestToolNames,
    providerId: route.provider.id,
    startedAt,
    onLog,
    faceLabel: "messages→responses",
    route,
    onUsage,
  });
}

function passThroughAnthropicSseWithUsage(
  upstreamResponse: Response,
  route: ResolvedProviderRoute,
  onUsage: GatewayUsageObserver | undefined,
  onLog: GatewayLogFn,
): Response {
  if (!upstreamResponse.body) {
    return upstreamResponse;
  }

  const reader = upstreamResponse.body.getReader();
  const tracker = newAnthropicStreamUsageTracker();
  const utf8Decoder = createStreamUtf8Decoder();
  let sseBuffer = "";
  let usageSettled = false;

  const settleUsage = () => {
    if (usageSettled || !onUsage) {
      return;
    }
    usageSettled = true;
    settleMessagesStreamUsage(tracker, route, onUsage, onLog, undefined);
  };

  const observeBlocks = (blocks: readonly string[]) => {
    for (const block of blocks) {
      const event = parseAnthropicStreamEventBlock(block);
      if (event) {
        trackAnthropicStreamUsage(tracker, event);
        if (event.type === "message_stop") {
          settleUsage();
        }
      }
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            sseBuffer = finalizeStreamUtf8Decoder(utf8Decoder, sseBuffer);
            if (sseBuffer.trim()) {
              const { blocks } = splitSseBlocks(`${sseBuffer}\n\n`);
              observeBlocks(blocks);
            }
            settleUsage();
            controller.close();
            return;
          }
          if (value) {
            controller.enqueue(value);
            sseBuffer = appendStreamUtf8Chunk(utf8Decoder, sseBuffer, value);
            const { blocks, remainder } = splitSseBlocks(sseBuffer);
            sseBuffer = remainder;
            observeBlocks(blocks);
          }
        }
      } catch (error) {
        settleUsage();
        try {
          controller.error(error instanceof Error ? error : new Error(String(error)));
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      void reader.cancel().catch(() => undefined);
    },
  });

  const headers = new Headers(upstreamResponse.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "text/event-stream; charset=utf-8");
  }
  if (!headers.has("cache-control")) {
    headers.set("cache-control", "no-cache");
  }

  return new Response(stream, {
    status: upstreamResponse.status,
    headers,
  });
}

function mapResponsesSseBodyToAnthropic(input: {
  upstreamBody: ReadableStream<Uint8Array>;
  requestToolNames: readonly string[];
  providerId: string;
  startedAt: number;
  onLog: GatewayLogFn;
  /** Log label for ops (chat vs responses face). */
  faceLabel?: string;
  route?: ResolvedProviderRoute;
  onUsage?: GatewayUsageObserver;
}): Response {
  const face = input.faceLabel ?? "messages→responses";
  const state = newResponsesEventToAnthropicState(input.requestToolNames);
  const utf8Decoder = createStreamUtf8Decoder();
  let sseBuffer = "";
  const reader = input.upstreamBody.getReader();
  const encoder = new TextEncoder();
  let rawEventCount = 0;
  let anthropicEventCount = 0;
  const rawTypes: Record<string, number> = {};
  let parseFailures = 0;
  let firstByteLogged = false;
  let closed = false;
  const usageTracker = newAnthropicStreamUsageTracker();
  let fallbackResponsesUsage: ParsedUsage | undefined;
  let fallbackResponseId: string | undefined;
  let usageSettled = false;

  const settleUsage = () => {
    if (usageSettled || !input.onUsage || !input.route) {
      return;
    }
    usageSettled = true;
    settleMessagesStreamUsage(
      usageTracker,
      input.route,
      input.onUsage,
      input.onLog,
      fallbackResponsesUsage
        ? { usage: fallbackResponsesUsage, responseId: fallbackResponseId }
        : undefined,
    );
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const firstEventTimer = setTimeout(() => {
        if (closed || rawEventCount > 0) {
          return;
        }
        const msg =
          `${face} timed out waiting for first converted SSE event ` +
          `after ${RESPONSES_STREAM_FIRST_EVENT_TIMEOUT_MS}ms (provider=${input.providerId}).`;
        input.onLog(msg);
        try {
          controller.enqueue(
            encoder.encode(
              responsesAnthropicEventToSse({
                type: "error",
                error: { type: "api_error", message: msg },
              } as never),
            ),
          );
          controller.close();
          closed = true;
        } catch {
          // already closed
        }
        void reader.cancel().catch(() => undefined);
      }, RESPONSES_STREAM_FIRST_EVENT_TIMEOUT_MS);

      const pump = async () => {
        try {
          while (!closed) {
            const { done, value } = await reader.read();
            if (done) {
              clearTimeout(firstEventTimer);
              sseBuffer = finalizeStreamUtf8Decoder(utf8Decoder, sseBuffer);
              if (sseBuffer.trim()) {
                const { blocks } = splitSseBlocks(`${sseBuffer}\n\n`);
                for (const block of blocks) {
                  const counts = enqueueAnthropicFromResponsesSse(
                    block,
                    state,
                    controller,
                    encoder,
                    rawTypes,
                    usageTracker,
                    (usage, responseId) => {
                      fallbackResponsesUsage = usage;
                      if (responseId) {
                        fallbackResponseId = responseId;
                      }
                    },
                    input.route?.upstreamModelId,
                  );
                  rawEventCount += counts.raw;
                  anthropicEventCount += counts.anth;
                  parseFailures += counts.parseFail;
                }
              }
              for (const event of finalizeResponsesAnthropicStream(state)) {
                anthropicEventCount += 1;
                trackAnthropicStreamUsage(usageTracker, event as never);
                controller.enqueue(encoder.encode(responsesAnthropicEventToSse(event)));
              }
              settleUsage();
              if (!state.messageStartSent) {
                const msg =
                  `${face} produced no Anthropic stream events ` +
                  `(raw=${rawEventCount} parseFail=${parseFailures} types=${JSON.stringify(rawTypes)}).`;
                input.onLog(msg);
                controller.enqueue(
                  encoder.encode(
                    responsesAnthropicEventToSse({
                      type: "error",
                      error: { type: "api_error", message: msg },
                    } as never),
                  ),
                );
              } else {
                input.onLog(
                  `${face} stream done raw=${rawEventCount} anth=${anthropicEventCount} ` +
                    `elapsed=${Date.now() - input.startedAt}ms provider=${input.providerId}`,
                );
              }
              if (!closed) {
                controller.close();
                closed = true;
              }
              return;
            }

            if (!firstByteLogged && value) {
              firstByteLogged = true;
              input.onLog(
                `${face} first byte after ${Date.now() - input.startedAt}ms len=${value.byteLength}`,
              );
            }

            sseBuffer = appendStreamUtf8Chunk(utf8Decoder, sseBuffer, value);
            const { blocks, remainder } = splitSseBlocks(sseBuffer);
            sseBuffer = remainder;
            for (const block of blocks) {
              const counts = enqueueAnthropicFromResponsesSse(
                block,
                state,
                controller,
                encoder,
                rawTypes,
                usageTracker,
                (usage, responseId) => {
                  fallbackResponsesUsage = usage;
                  if (responseId) {
                    fallbackResponseId = responseId;
                  }
                },
                input.route?.upstreamModelId,
              );
              rawEventCount += counts.raw;
              anthropicEventCount += counts.anth;
              parseFailures += counts.parseFail;
            }
          }
        } catch (error) {
          clearTimeout(firstEventTimer);
          settleUsage();
          if (closed) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          input.onLog(`${face} stream pump failed: ${message}`);
          try {
            controller.enqueue(
              encoder.encode(
                responsesAnthropicEventToSse({
                  type: "error",
                  error: { type: "api_error", message },
                } as never),
              ),
            );
            controller.close();
          } catch {
            try {
              controller.error(error instanceof Error ? error : new Error(message));
            } catch {
              // ignore
            }
          }
          closed = true;
        }
      };

      void pump();
    },
    cancel() {
      closed = true;
      settleUsage();
      void reader.cancel().catch(() => undefined);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}

function enqueueAnthropicFromResponsesSse(
  block: string,
  state: ReturnType<typeof newResponsesEventToAnthropicState>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  rawTypes: Record<string, number>,
  usageTracker: AnthropicStreamUsageTracker,
  onResponsesUsage: (usage: ParsedUsage, responseId?: string) => void,
  modelId: string | undefined,
): { raw: number; anth: number; parseFail: number } {
  const parsed = parseResponsesStreamEventBlock(block);
  if (!parsed) {
    // Keep prior fallback for non-standard framing.
    const dataLine = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("data:"));
    if (!dataLine) {
      return { raw: 0, anth: 0, parseFail: 0 };
    }
    const payload = dataLine.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") {
      return { raw: 0, anth: 0, parseFail: 0 };
    }
    try {
      const event = JSON.parse(payload) as ResponsesStreamEvent;
      return emitConverted(
        event,
        state,
        controller,
        encoder,
        rawTypes,
        usageTracker,
        onResponsesUsage,
        modelId,
      );
    } catch {
      return { raw: 0, anth: 0, parseFail: 1 };
    }
  }
  return emitConverted(
    parsed,
    state,
    controller,
    encoder,
    rawTypes,
    usageTracker,
    onResponsesUsage,
    modelId,
  );
}

function emitConverted(
  event: ResponsesStreamEvent,
  state: ReturnType<typeof newResponsesEventToAnthropicState>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  rawTypes: Record<string, number>,
  usageTracker: AnthropicStreamUsageTracker,
  onResponsesUsage: (usage: ParsedUsage, responseId?: string) => void,
  modelId: string | undefined,
): { raw: number; anth: number; parseFail: number } {
  const type = typeof event.type === "string" ? event.type : "unknown";
  rawTypes[type] = (rawTypes[type] ?? 0) + 1;

  const fromResponses = extractUsageFromResponsesStreamEvent(event, modelId);
  if (fromResponses) {
    const responseId =
      typeof (event as { response?: { id?: string } }).response?.id === "string"
        ? (event as { response: { id: string } }).response.id
        : undefined;
    onResponsesUsage(fromResponses, responseId);
  }

  // Unknown OpenAI-compat error object inside stream.
  if (type === "error" || (event as { error?: unknown }).error) {
    const errObj = (event as { error?: { message?: string } | string }).error;
    const message =
      typeof errObj === "string"
        ? errObj
        : typeof errObj?.message === "string"
          ? errObj.message
          : JSON.stringify(event).slice(0, 400);
    controller.enqueue(
      encoder.encode(
        responsesAnthropicEventToSse({
          type: "error",
          error: { type: "api_error", message },
        } as never),
      ),
    );
    return { raw: 1, anth: 1, parseFail: 0 };
  }

  const anthEvents = responsesEventToAnthropicEvents(event, state);
  for (const anthropicEvent of anthEvents) {
    trackAnthropicStreamUsage(usageTracker, anthropicEvent);
    controller.enqueue(encoder.encode(responsesAnthropicEventToSse(anthropicEvent)));
  }
  return { raw: 1, anth: anthEvents.length, parseFail: 0 };
}

function settleMessagesStreamUsage(
  tracker: AnthropicStreamUsageTracker,
  route: ResolvedProviderRoute,
  onUsage: GatewayUsageObserver,
  onLog: GatewayLogFn,
  fallback?: { usage: ParsedUsage; responseId?: string },
): void {
  const outcome = resolveAnthropicStreamUsage(tracker);
  if (outcome.status === "resolved") {
    emitMessagesUsage(onUsage, route, outcome.usage, true, outcome.responseId, onLog);
    return;
  }
  if (fallback?.usage) {
    onLog(
      `messages stream anthropic tracker rejected (${outcome.reason}); using Responses usage fallback ` +
        `provider=${route.provider.id} model=${route.upstreamModelId}`,
    );
    emitMessagesUsage(
      onUsage,
      route,
      fallback.usage,
      true,
      fallback.responseId,
      onLog,
    );
    return;
  }
  onLog(
    `messages stream usage rejected provider=${route.provider.id} model=${route.upstreamModelId} ` +
      `reason=${outcome.reason}; usage will not be billed`,
  );
}

async function postResponsesWithUnsupportedParamRetry(input: {
  fetchImpl: typeof fetch;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  onLog: GatewayLogFn;
  route: ResolvedProviderRoute;
}): Promise<{
  response: Response;
  body: Record<string, unknown>;
  droppedParams: string[];
}> {
  const body = { ...input.body };
  const droppedParams: string[] = [];
  for (let attempt = 0; attempt <= MAX_UNSUPPORTED_PARAM_DROPS; attempt += 1) {
    const payload = JSON.stringify(body);
    input.onLog(
      `messages→responses POST ${input.url} provider=${input.route.provider.id} ` +
        `model=${input.route.upstreamModelId} bytes=${payload.length} attempt=${attempt}`,
    );
    const response = await input.fetchImpl(input.url, {
      method: "POST",
      headers: input.headers,
      body: payload,
    });
    if (response.ok || response.status < 400 || response.status >= 500) {
      return { response, body, droppedParams };
    }
    // Need body text to detect unsupported params; clone path via text then rebuild Response.
    const text = await response.text();
    const param = extractUnsupportedResponsesParameter(text);
    if (!param || !DROPPABLE_RESPONSES_PARAMS.has(param) || !(param in body)) {
      return {
        response: new Response(text, {
          status: response.status,
          headers: response.headers,
        }),
        body,
        droppedParams,
      };
    }
    delete body[param];
    droppedParams.push(param);
    input.onLog(
      `messages→responses drop unsupported param=${param} attempt=${attempt} provider=${input.route.provider.id}`,
    );
  }
  const payload = JSON.stringify(body);
  const response = await input.fetchImpl(input.url, {
    method: "POST",
    headers: input.headers,
    body: payload,
  });
  return { response, body, droppedParams };
}

function extractUnsupportedResponsesParameter(raw: string): string | undefined {
  const patterns = [
    /Unsupported parameter:\s*['"`]?([A-Za-z0-9_.-]+)['"`]?/i,
    /Unknown parameter:\s*['"`]?([A-Za-z0-9_.-]+)['"`]?/i,
    /Unrecognized request argument supplied:\s*['"`]?([A-Za-z0-9_.-]+)['"`]?/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    const param = match?.[1]?.trim().split(/[.[\]]/, 1)[0];
    if (param) return param;
  }
  return undefined;
}

function anthropicErrorResponse(status: number, message: string): Response {
  return Response.json(
    {
      type: "error",
      error: {
        type: "api_error",
        message,
      },
    },
    { status: status >= 400 && status < 600 ? status : 502 },
  );
}

function anthropicErrorSseResponse(status: number, message: string): Response {
  // Claude Agent SDK stream path: emit a single error event then close.
  const payload = responsesAnthropicEventToSse({
    type: "error",
    error: { type: "api_error", message: `[${status}] ${message}` },
  } as never);
  return new Response(payload, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}

function anthropicJsonAsSse(anthropic: ReturnType<typeof responsesToAnthropic>): Response {
  // Best-effort non-stream→stream wrap: message_start / content / message_stop via re-serialize of final message.
  // Prefer mapping through a synthetic completed response when full JSON is present.
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  const msg = anthropic as {
    id?: string;
    model?: string;
    content?: Array<{ type?: string; text?: string; thinking?: string }>;
    stop_reason?: string | null;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  chunks.push(
    responsesAnthropicEventToSse({
      type: "message_start",
      message: {
        id: msg.id ?? "msg_synth",
        type: "message",
        role: "assistant",
        content: [],
        model: msg.model ?? "",
        stop_reason: "",
        usage: {
          input_tokens: msg.usage?.input_tokens ?? 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    } as never),
  );
  let index = 0;
  for (const block of msg.content ?? []) {
    if (block.type === "text" && block.text) {
      chunks.push(
        responsesAnthropicEventToSse({
          type: "content_block_start",
          index,
          content_block: { type: "text", text: "" },
        } as never),
      );
      chunks.push(
        responsesAnthropicEventToSse({
          type: "content_block_delta",
          index,
          delta: { type: "text_delta", text: block.text },
        } as never),
      );
      chunks.push(
        responsesAnthropicEventToSse({
          type: "content_block_stop",
          index,
        } as never),
      );
      index += 1;
    }
  }
  chunks.push(
    responsesAnthropicEventToSse({
      type: "message_delta",
      delta: { stop_reason: msg.stop_reason ?? "end_turn" },
      usage: {
        input_tokens: msg.usage?.input_tokens ?? 0,
        output_tokens: msg.usage?.output_tokens ?? 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    } as never),
  );
  chunks.push(responsesAnthropicEventToSse({ type: "message_stop" } as never));
  return new Response(encoder.encode(chunks.join("")), {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}

function emitMessagesUsage(
  onUsage: GatewayUsageObserver,
  route: ResolvedProviderRoute,
  usage: NonNullable<ReturnType<typeof normalizeAnthropicUsage>>,
  stream: boolean,
  responseId: string | undefined,
  onLog: GatewayLogFn,
): void {
  const event: GatewayUsageEvent = {
    source: "messages",
    sourceEventId: `messages:${route.provider.id}:${responseId ?? Date.now()}`,
    providerId: route.provider.id,
    requestedModel: route.requestedModel,
    upstreamModelId: route.upstreamModelId,
    usage,
    stream,
    observedAt: new Date().toISOString(),
    ...(responseId ? { responseId } : {}),
  };
  try {
    void Promise.resolve(onUsage(event)).catch((error) => {
      onLog(`usage observer failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  } catch (error) {
    onLog(`usage observer failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
