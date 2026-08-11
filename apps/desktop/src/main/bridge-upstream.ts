import type http from "node:http";
import { StringDecoder } from "node:string_decoder";
import {
  type AnthropicRequest,
  type AnthropicResponse,
  type AnthropicStreamEvent,
  anthropicEventToResponsesEvents,
  anthropicToResponses,
  type ChatCompletionsChunk,
  type ChatCompletionsResponse,
  chatCompletionsChunkToResponsesEvents,
  chatCompletionsResponseToResponses,
  checkAnthropicStreamEvent,
  extractAnthropicRequestToolNames,
  finalizeAnthropicResponsesStream,
  finalizeChatCompletionsResponsesStream,
  finalizeResponsesAnthropicStream,
  newAnthropicEventToResponsesState,
  newAnthropicStreamSequenceState,
  newChatCompletionsToResponsesStreamState,
  newResponsesEventToAnthropicState,
  type ResponsesResponse,
  type ResponsesStreamEvent,
  responsesAnthropicEventToSse,
  responsesEventToAnthropicEvents,
  responsesToAnthropic,
  responsesToChatCompletionsRequest,
} from "@eco/openai-anthropic-bridge";
import type { ParsedUsage } from "@eco/runtime";
import { truncateToolOutputForHistory } from "@eco/runtime";
import type { UpstreamApiCompat } from "../shared/api-compat";
import type { RuntimeAgentRole } from "../shared/ipc";
import { anthropicResponseToStreamEvents, writeAnthropicStreamEvents } from "./anthropic-stream-replay";
import {
  createStreamingUsageTracker,
  extractUsageFromResponseBody,
  resolveChatCompletionsStreamUsage,
} from "./anthropic-usage";
import { applyDisableThinkingUpstreamPatch } from "./disable-thinking-patch";
import { postJsonWithOpenAIResponsesUnsupportedParameterRetry } from "./openai-responses-compat";
import {
  buildChatCompletionsUrl,
  buildOpenAICompatUpstreamUrl,
  buildProviderRequestBaseUrl,
} from "./provider-models";
import type { ProviderConfigSecret } from "./provider-store";
import {
  applyProxyCchToAnthropicMessagesBody,
  isProxyCchAuditEnabled,
} from "./proxy-cch-audit";
import { logProxyRequestShape } from "./proxy-request-shape-log";
import {
  formatUpstreamFetchError,
  headersToLoggable,
  logUpstream,
  logUpstreamError,
  parseJsonForLog,
} from "./upstream-log";
import {
  buildProxyCallDebug,
  isUpstreamLogVerbose,
  logUpstreamProxyCall,
  proxyCallCommonFields,
  resolveProxyCallBilling,
  tokensFromUsage,
  type UpstreamProxyCallBilling,
} from "./upstream-proxy-log";
import { buildProxyUpstreamHeaders } from "./upstream-request-headers";

export interface BridgeForwardRoute {
  role: RuntimeAgentRole;
  provider: ProviderConfigSecret;
  modelId: string;
  apiCompat: UpstreamApiCompat;
  aliasModelId: string;
  /** Eco manualSpec output cap; applied on the final upstream wire body. */
  maxOutputTokens?: number;
}

/** Force configured output cap onto the upstream wire format (after apiCompat conversion). */
export function applyUpstreamMaxOutputLimit(
  body: Record<string, unknown>,
  apiCompat: UpstreamApiCompat,
  maxOutputTokens?: number,
): void {
  if (maxOutputTokens === undefined || maxOutputTokens <= 0) {
    return;
  }
  if (apiCompat === "openai_responses") {
    body.max_output_tokens = maxOutputTokens;
    return;
  }
  if (apiCompat === "openai_chat_completions") {
    // New API → llama.cpp and other legacy OpenAI-compat relays honor max_tokens, not
    // max_completion_tokens. Drop the latter so intermediaries cannot prefer an ignored field.
    body.max_tokens = maxOutputTokens;
    delete body.max_completion_tokens;
    return;
  }
  body.max_tokens = maxOutputTokens;
}

export interface BridgeUpstreamConnectionErrorInfo {
  role: RuntimeAgentRole;
  error: string;
  statusCode?: number;
}

export interface BridgeForwardContext {
  threadId?: string;
  route: BridgeForwardRoute;
  body: Record<string, unknown>;
  requestedModel?: string;
  requestUrl?: string;
  upstreamUserAgent?: string;
  onUsage?: BridgeUsageHandler;
  onUpstreamConnectionError?: (info: BridgeUpstreamConnectionErrorInfo) => void;
  onUpstreamRequestId?: (requestId: string) => void;
}

export interface BridgeUsageInfo {
  role: RuntimeAgentRole;
  providerId: string;
  providerName: string;
  providerBaseUrl: string;
  modelId: string;
  apiCompat: UpstreamApiCompat;
  requestedModel?: string;
  requestId?: string;
  downstreamMessageId?: string;
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
  downstreamMessageId?: string,
): BridgeUsageInfo {
  return {
    role: route.role,
    providerId: route.provider.id,
    providerName: route.provider.name,
    providerBaseUrl: route.provider.baseUrl,
    modelId: route.modelId,
    apiCompat: route.apiCompat,
    ...(requestedModel && { requestedModel }),
    ...(requestId && { requestId }),
    ...(downstreamMessageId && { downstreamMessageId }),
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

function notifyBridgeProxyFailure(ctx: BridgeForwardContext, error: string, statusCode?: number): void {
  ctx.onUpstreamConnectionError?.({
    role: ctx.route.role,
    error,
    ...(statusCode !== undefined && { statusCode }),
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

function logBridgeMessagesShape(input: {
  ctx: BridgeForwardContext;
  operation: "messages";
  upstreamUrl: string;
  stream: boolean;
  converted: boolean;
  upstreamBody: Record<string, unknown>;
}): void {
  logProxyRequestShape({
    ...(input.ctx.threadId && { threadId: input.ctx.threadId }),
    operation: input.operation,
    route: input.ctx.route,
    ...(input.ctx.requestedModel && { requestedModel: input.ctx.requestedModel }),
    ...(input.ctx.requestUrl && { requestUrl: input.ctx.requestUrl }),
    upstreamUrl: input.upstreamUrl,
    stream: input.stream,
    converted: input.converted,
    clientBody: input.ctx.body,
    upstreamBody: input.upstreamBody,
  });
}

/** Anthropic apiCompat: substitute routed model only (no Responses IR). */
export function buildAnthropicPassthroughPayload(
  body: Record<string, unknown>,
  modelId: string,
): Record<string, unknown> {
  return { ...body, model: modelId };
}

const CLEAR_TOOL_USES_EDIT_TYPE = "clear_tool_uses_20250919";
const DEFAULT_CONTEXT_MANAGEMENT_INPUT_TOKENS_TRIGGER = 100_000;
const DEFAULT_CONTEXT_MANAGEMENT_KEEP_TOOL_USES = 3;
const CONTEXT_MANAGEMENT_CLEARED_TOOL_RESULT_PLACEHOLDER = "[Cleared by context management]";
const APPROX_CHARS_PER_TOKEN = 4;

export interface GatewayContextManagementAppliedEdit {
  type: typeof CLEAR_TOOL_USES_EDIT_TYPE;
  cleared_tool_uses: number;
  estimated_cleared_input_tokens: number;
  warnings?: string[];
}

export interface GatewayContextManagementPolyfillResult {
  request: AnthropicRequest;
  appliedEdits: GatewayContextManagementAppliedEdit[];
}

function safeJsonLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function estimateAnthropicInputTokens(req: AnthropicRequest): number {
  const chars = safeJsonLength({
    system: req.system ?? null,
    messages: req.messages,
    tools: req.tools ?? [],
  });
  return Math.ceil(chars / APPROX_CHARS_PER_TOKEN);
}

const SEMANTIC_COMPACTION_EDIT_TYPES = new Set(["compact_20260112", "compaction"]);

function isSemanticCompactionEdit(value: unknown): boolean {
  return isRecord(value) && typeof value.type === "string" && SEMANTIC_COMPACTION_EDIT_TYPES.has(value.type);
}

/**
 * Eco owns semantic history compaction. Provider-specific compaction directives are
 * removed before any Anthropic passthrough or OpenAI-compatible conversion.
 */
export function stripSemanticCompactionDirectives(request: AnthropicRequest): AnthropicRequest {
  const contextManagement = request.context_management;
  if (Array.isArray(contextManagement)) {
    const edits = contextManagement.filter((edit) => !isSemanticCompactionEdit(edit));
    if (edits.length === contextManagement.length) {
      return request;
    }
    const next = { ...request };
    if (edits.length > 0) {
      next.context_management = edits;
    } else {
      delete next.context_management;
    }
    return next;
  }
  if (!isRecord(contextManagement) || !Array.isArray(contextManagement.edits)) {
    return request;
  }
  const edits = contextManagement.edits.filter((edit) => !isSemanticCompactionEdit(edit));
  if (edits.length === contextManagement.edits.length) {
    return request;
  }
  const nextContextManagement = { ...contextManagement, edits };
  const next = { ...request };
  if (edits.length === 0 && Object.keys(nextContextManagement).length === 1) {
    delete next.context_management;
  } else {
    next.context_management = nextContextManagement;
  }
  return next;
}

function readContextManagementEdits(spec: unknown): Record<string, unknown>[] {
  if (Array.isArray(spec)) {
    return spec.filter(isRecord);
  }
  if (!isRecord(spec) || !Array.isArray(spec.edits)) {
    return [];
  }
  return spec.edits.filter(isRecord);
}

function contentRecordBlocks(content: unknown): Record<string, unknown>[] {
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

function collectToolUseIdsInOrder(messages: AnthropicRequest["messages"]): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    for (const block of contentRecordBlocks(message.content)) {
      if (block.type === "tool_use" && typeof block.id === "string") {
        ids.push(block.id);
      }
    }
  }
  return ids;
}

function countToolUses(messages: AnthropicRequest["messages"]): number {
  return collectToolUseIdsInOrder(messages).length;
}

function lastCompletedToolUseId(messages: AnthropicRequest["messages"]): string | undefined {
  let lastId: string | undefined;
  for (const message of messages) {
    for (const block of contentRecordBlocks(message.content)) {
      if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        lastId = block.tool_use_id;
      }
    }
  }
  return lastId;
}

function isClearedToolResultContent(content: unknown): boolean {
  if (content === CONTEXT_MANAGEMENT_CLEARED_TOOL_RESULT_PLACEHOLDER) {
    return true;
  }
  if (!Array.isArray(content) || content.length !== 1) {
    return false;
  }
  const only = content[0];
  return (
    isRecord(only) && only.type === "text" && only.text === CONTEXT_MANAGEMENT_CLEARED_TOOL_RESULT_PLACEHOLDER
  );
}

function buildClearedToolResultContent(originalContent: unknown): string | Array<Record<string, string>> {
  if (Array.isArray(originalContent)) {
    return [{ type: "text", text: CONTEXT_MANAGEMENT_CLEARED_TOOL_RESULT_PLACEHOLDER }];
  }
  return CONTEXT_MANAGEMENT_CLEARED_TOOL_RESULT_PLACEHOLDER;
}

function clearToolResults(
  messages: AnthropicRequest["messages"],
  idsToClear: ReadonlySet<string>,
): { messages: AnthropicRequest["messages"]; clearedCount: number } {
  let clearedCount = 0;
  let anyMessageMutated = false;
  const nextMessages = messages.map((message) => {
    if (!Array.isArray(message.content)) {
      return message;
    }

    let mutated = false;
    const nextContent = message.content.map((block) => {
      if (
        !isRecord(block) ||
        block.type !== "tool_result" ||
        typeof block.tool_use_id !== "string" ||
        !idsToClear.has(block.tool_use_id) ||
        isClearedToolResultContent(block.content)
      ) {
        return block;
      }

      mutated = true;
      clearedCount += 1;
      return {
        ...block,
        content: buildClearedToolResultContent(block.content),
      };
    });

    if (!mutated) {
      return message;
    }
    anyMessageMutated = true;
    return { ...message, content: nextContent };
  });

  return { messages: anyMessageMutated ? nextMessages : messages, clearedCount };
}

function clearToolUsesTriggerMet(edit: Record<string, unknown>, req: AnthropicRequest): boolean {
  const trigger = isRecord(edit.trigger)
    ? edit.trigger
    : { type: "input_tokens", value: DEFAULT_CONTEXT_MANAGEMENT_INPUT_TOKENS_TRIGGER };
  const triggerType = typeof trigger.type === "string" ? trigger.type : "input_tokens";
  const threshold = trigger.value;

  if (triggerType === "tool_uses") {
    if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
      return false;
    }
    return countToolUses(req.messages) > Math.trunc(threshold);
  }

  const inputTokenThreshold =
    typeof threshold === "number" && Number.isFinite(threshold)
      ? Math.trunc(threshold)
      : DEFAULT_CONTEXT_MANAGEMENT_INPUT_TOKENS_TRIGGER;
  return estimateAnthropicInputTokens(req) > inputTokenThreshold;
}

function resolveClearToolUsesKeepCount(edit: Record<string, unknown>): number {
  const keep = isRecord(edit.keep)
    ? edit.keep
    : { type: "tool_uses", value: DEFAULT_CONTEXT_MANAGEMENT_KEEP_TOOL_USES };
  if (keep.type !== undefined && keep.type !== "tool_uses") {
    return DEFAULT_CONTEXT_MANAGEMENT_KEEP_TOOL_USES;
  }
  if (typeof keep.value !== "number" || !Number.isFinite(keep.value) || keep.value < 0) {
    return DEFAULT_CONTEXT_MANAGEMENT_KEEP_TOOL_USES;
  }
  return Math.trunc(keep.value);
}

function applyClearToolUsesEdit(
  req: AnthropicRequest,
  edit: Record<string, unknown>,
): { request: AnthropicRequest; appliedEdit?: GatewayContextManagementAppliedEdit } {
  if (!clearToolUsesTriggerMet(edit, req)) {
    return { request: req };
  }

  const keepCount = resolveClearToolUsesKeepCount(edit);
  const toolUseIds = collectToolUseIdsInOrder(req.messages);
  if (toolUseIds.length <= keepCount) {
    return { request: req };
  }

  const idsToClear = new Set(toolUseIds.slice(0, toolUseIds.length - keepCount));
  const lastCompletedId = lastCompletedToolUseId(req.messages);
  if (lastCompletedId !== undefined) {
    idsToClear.delete(lastCompletedId);
  }
  if (idsToClear.size === 0) {
    return { request: req };
  }

  const estimatedTokensBefore = estimateAnthropicInputTokens(req);
  const cleared = clearToolResults(req.messages, idsToClear);
  if (cleared.clearedCount === 0) {
    return { request: req };
  }

  const editedRequest = { ...req, messages: cleared.messages };
  const estimatedTokensAfter = estimateAnthropicInputTokens(editedRequest);
  const ignoredKnobs = ["clear_at_least", "exclude_tools", "clear_tool_inputs"].filter((knob) =>
    Object.hasOwn(edit, knob),
  );
  const appliedEdit: GatewayContextManagementAppliedEdit = {
    type: CLEAR_TOOL_USES_EDIT_TYPE,
    cleared_tool_uses: cleared.clearedCount,
    estimated_cleared_input_tokens: Math.max(estimatedTokensBefore - estimatedTokensAfter, 0),
    ...(ignoredKnobs.length > 0 && {
      warnings: ignoredKnobs.map((knob) => `${knob}_ignored`),
    }),
  };
  return { request: editedRequest, appliedEdit };
}

export function applyGatewayContextManagementPolyfill(
  request: AnthropicRequest,
): GatewayContextManagementPolyfillResult {
  let currentRequest = request;
  const appliedEdits: GatewayContextManagementAppliedEdit[] = [];

  for (const edit of readContextManagementEdits(request.context_management)) {
    if (edit.type !== CLEAR_TOOL_USES_EDIT_TYPE) {
      continue;
    }
    const result = applyClearToolUsesEdit(currentRequest, edit);
    currentRequest = result.request;
    if (result.appliedEdit !== undefined) {
      appliedEdits.push(result.appliedEdit);
    }
  }

  return { request: currentRequest, appliedEdits };
}

/**
 * Codex-aligned defense-in-depth: middle-truncate oversized tool_result payloads on
 * the Anthropic messages request before it is sent upstream or converted to
 * OpenAI IR (same policy as PostToolUse / ContextManager::record_items).
 */
export function pruneAnthropicToolResults(request: AnthropicRequest): {
  request: AnthropicRequest;
  prunedCount: number;
} {
  let prunedCount = 0;
  let anyMessageMutated = false;
  const nextMessages = request.messages.map((message) => {
    if (!Array.isArray(message.content)) {
      return message;
    }
    let messageMutated = false;
    const nextContent = message.content.map((block) => {
      if (!isRecord(block) || block.type !== "tool_result") {
        return block;
      }
      const pruned = pruneToolResultContent(block.content);
      if (!pruned.mutated) {
        return block;
      }
      prunedCount += 1;
      messageMutated = true;
      return { ...block, content: pruned.content };
    });
    if (!messageMutated) {
      return message;
    }
    anyMessageMutated = true;
    return { ...message, content: nextContent };
  });
  if (!anyMessageMutated) {
    return { request, prunedCount: 0 };
  }
  return { request: { ...request, messages: nextMessages }, prunedCount };
}

function pruneToolResultContent(content: unknown): { content: unknown; mutated: boolean } {
  if (typeof content === "string") {
    const pruned = truncateToolOutputForHistory(content);
    if (!pruned.truncated) {
      return { content, mutated: false };
    }
    return { content: pruned.text, mutated: true };
  }
  if (!Array.isArray(content)) {
    const pruned = truncateToolOutputForHistory(content);
    if (!pruned.truncated) {
      return { content, mutated: false };
    }
    return { content: pruned.text, mutated: true };
  }

  // Prefer pruning merged text segments (Codex content-items behavior).
  const textParts: string[] = [];
  for (const entry of content) {
    if (typeof entry === "string" && entry) {
      textParts.push(entry);
      continue;
    }
    if (isRecord(entry) && typeof entry.text === "string") {
      textParts.push(entry.text);
    }
  }
  if (textParts.length === 0) {
    return { content, mutated: false };
  }
  const combined = textParts.join("\n");
  const pruned = truncateToolOutputForHistory(combined);
  if (!pruned.truncated) {
    return { content, mutated: false };
  }
  // Collapse text items into a single truncated text block; keep non-text items.
  const nonText = content.filter((entry) => {
    if (typeof entry === "string") {
      return false;
    }
    if (!isRecord(entry)) {
      return true;
    }
    return entry.type !== "text" && typeof entry.text !== "string";
  });
  return {
    content: [{ type: "text", text: pruned.text }, ...nonText],
    mutated: true,
  };
}

/**
 * Prune Responses IR function_call_output / custom_tool_call_output bodies after conversion.
 */
export function pruneResponsesToolOutputs(body: Record<string, unknown>): {
  body: Record<string, unknown>;
  prunedCount: number;
} {
  if (!Array.isArray(body.input)) {
    return { body, prunedCount: 0 };
  }
  let prunedCount = 0;
  let anyMutated = false;
  const nextInput = body.input.map((item) => {
    if (!isRecord(item)) {
      return item;
    }
    if (item.type !== "function_call_output" && item.type !== "custom_tool_call_output") {
      return item;
    }
    const output = item.output;
    if (typeof output === "string") {
      const pruned = truncateToolOutputForHistory(output);
      if (!pruned.truncated) {
        return item;
      }
      prunedCount += 1;
      anyMutated = true;
      return { ...item, output: pruned.text };
    }
    if (isRecord(output) && typeof output === "object") {
      // Some IR shapes nest text under output.
      const asText =
        typeof (output as { text?: unknown }).text === "string"
          ? (output as { text: string }).text
          : coerceUnknownToolOutput(output);
      const pruned = truncateToolOutputForHistory(asText);
      if (!pruned.truncated) {
        return item;
      }
      prunedCount += 1;
      anyMutated = true;
      return { ...item, output: pruned.text };
    }
    const coerced = coerceUnknownToolOutput(output);
    const pruned = truncateToolOutputForHistory(coerced);
    if (!pruned.truncated) {
      return item;
    }
    prunedCount += 1;
    anyMutated = true;
    return { ...item, output: pruned.text };
  });
  if (!anyMutated) {
    return { body, prunedCount: 0 };
  }
  return { body: { ...body, input: nextInput }, prunedCount };
}

function coerceUnknownToolOutput(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function logGatewayContextManagementPolyfill(input: {
  apiCompat: UpstreamApiCompat;
  requestedModel: string;
  upstreamModel: string;
  before: AnthropicRequest;
  after: AnthropicRequest;
  appliedEdits: GatewayContextManagementAppliedEdit[];
}): void {
  const beforeChars = safeJsonLength(input.before.messages);
  const afterChars = safeJsonLength(input.after.messages);
  logUpstream("context-management-polyfill", {
    apiCompat: input.apiCompat,
    requestedModel: input.requestedModel,
    upstreamModel: input.upstreamModel,
    appliedEdits: input.appliedEdits,
    messagesJsonCharsBefore: beforeChars,
    messagesJsonCharsAfter: afterChars,
    savedMessagesJsonChars: Math.max(beforeChars - afterChars, 0),
  });
}

export function isOpenRouterBaseUrl(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === "openrouter.ai" || hostname.endsWith(".openrouter.ai");
  } catch {
    return baseUrl.toLowerCase().includes("openrouter.ai");
  }
}

export function buildBridgePromptCacheKey(threadId?: string): string | undefined {
  const trimmed = threadId?.trim();
  if (!trimmed) {
    return undefined;
  }
  const sanitized = trimmed.replace(/[^A-Za-z0-9._:-]/g, "_");
  if (!sanitized) {
    return undefined;
  }
  return `eco_thread_${sanitized}`.slice(0, 64);
}

export function applyResponsesRoutingHints(
  body: Record<string, unknown>,
  input: { providerBaseUrl: string; threadId?: string },
): void {
  const promptCacheKey = buildBridgePromptCacheKey(input.threadId);
  if (promptCacheKey === undefined) {
    return;
  }
  if (body.prompt_cache_key === undefined) {
    body.prompt_cache_key = promptCacheKey;
  }
  if (isOpenRouterBaseUrl(input.providerBaseUrl) && body.session_id === undefined) {
    body.session_id = promptCacheKey;
  }
}

/** Responses IR → upstream wire format (OpenAI-compat apiCompat only). */
export function buildBridgeUpstreamMessagesPayload(
  apiCompat: UpstreamApiCompat,
  anthropicRequest: AnthropicRequest,
  modelId: string,
  stream: boolean,
  maxOutputTokens?: number,
): Record<string, unknown> {
  const sanitizedAnthropicRequest = stripSemanticCompactionDirectives(anthropicRequest);
  const toolPruned = pruneAnthropicToolResults(sanitizedAnthropicRequest);
  if (toolPruned.prunedCount > 0) {
    logUpstream("tool-output-prune", {
      apiCompat,
      requestedModel: sanitizedAnthropicRequest.model,
      upstreamModel: modelId,
      prunedToolResults: toolPruned.prunedCount,
    });
  }
  const requestAfterToolPrune = toolPruned.request;

  if (apiCompat === "anthropic") {
    const payload = buildAnthropicPassthroughPayload(
      requestAfterToolPrune as unknown as Record<string, unknown>,
      modelId,
    );
    applyUpstreamMaxOutputLimit(payload, apiCompat, maxOutputTokens);
    return payload;
  }

  const polyfill = applyGatewayContextManagementPolyfill(requestAfterToolPrune);
  const effectiveAnthropicRequest = polyfill.request;
  if (polyfill.appliedEdits.length > 0) {
    logGatewayContextManagementPolyfill({
      apiCompat,
      requestedModel: sanitizedAnthropicRequest.model,
      upstreamModel: modelId,
      before: requestAfterToolPrune,
      after: effectiveAnthropicRequest,
      appliedEdits: polyfill.appliedEdits,
    });
  }

  const responsesReq = anthropicToResponses(effectiveAnthropicRequest);
  responsesReq.model = modelId;
  responsesReq.stream = stream;

  if (apiCompat === "openai_responses") {
    let payload = responsesReq as unknown as Record<string, unknown>;
    const responsesPruned = pruneResponsesToolOutputs(payload);
    if (responsesPruned.prunedCount > 0) {
      logUpstream("tool-output-prune-responses", {
        apiCompat,
        requestedModel: sanitizedAnthropicRequest.model,
        upstreamModel: modelId,
        prunedToolResults: responsesPruned.prunedCount,
      });
      payload = responsesPruned.body;
    }
    applyUpstreamMaxOutputLimit(payload, apiCompat, maxOutputTokens);
    return payload;
  }

  // OpenAI Chat Completions (llama.cpp / DeepSeek / etc.) use reasoning_content deltas,
  // not OpenAI reasoning_effort. Provider connectivity tests expect this field absent.
  responsesReq.reasoning = undefined;

  const chatReq = responsesToChatCompletionsRequest(responsesReq);
  chatReq.model = modelId;
  chatReq.stream = stream;
  delete chatReq.reasoning_effort;
  const payload = chatReq as unknown as Record<string, unknown>;
  applyUpstreamMaxOutputLimit(payload, apiCompat, maxOutputTokens);
  applyDisableThinkingUpstreamPatch(payload, apiCompat, effectiveAnthropicRequest);
  return payload;
}

export function resolveBridgeUpstreamUrl(
  apiCompat: UpstreamApiCompat,
  baseUrl: string,
  requestPath: string,
  clientRequestUrl?: string,
  version?: string,
): string {
  if (apiCompat === "openai_chat_completions") {
    return buildChatCompletionsUrl(baseUrl, requestPath, version);
  }
  if (apiCompat === "openai_responses") {
    return buildOpenAICompatUpstreamUrl(baseUrl, requestPath, version);
  }

  const root = buildProviderRequestBaseUrl(baseUrl, requestPath);
  const ver = (version?.trim().replace(/^\/+|\/+$/g, "") || "v1");
  const path = clientRequestUrl?.split("?")[0] ?? `/${ver}/messages`;
  return `${trimTrailingSlash(root)}${path.startsWith("/") ? path : `/${path}`}`;
}

export function splitSseBlocks(buffer: string): { blocks: string[]; remainder: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const remainder = parts.pop() ?? "";
  return { blocks: parts.filter((block) => block.trim()), remainder };
}

/** Decode UTF-8 stream chunks without splitting multibyte sequences at TCP boundaries. */
export function createStreamUtf8Decoder(): StringDecoder {
  return new StringDecoder("utf8");
}

export function appendStreamUtf8Chunk(decoder: StringDecoder, buffer: string, chunk: Uint8Array): string {
  return buffer + decoder.write(Buffer.from(chunk));
}

export function finalizeStreamUtf8Decoder(decoder: StringDecoder, buffer: string): string {
  const tail = decoder.end();
  return tail ? buffer + tail : buffer;
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
    if (!parsed.type) {
      const raw = parsed as ResponsesStreamEvent & Record<string, unknown>;
      if (isRecord(raw.error)) {
        parsed.type = "error";
      } else if (raw.response !== undefined) {
        parsed.type = "response.created";
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extract a human-readable message from Responses API SSE error / failed events. */
export function extractResponsesStreamEventError(evt: ResponsesStreamEvent): string | undefined {
  if (evt.response?.error?.message?.trim()) {
    return evt.response.error.message.trim();
  }

  const nested = evt as ResponsesStreamEvent & Record<string, unknown>;
  if (isRecord(nested.error) && typeof nested.error.message === "string" && nested.error.message.trim()) {
    return nested.error.message.trim();
  }

  if (typeof nested.message === "string" && nested.message.trim()) {
    return nested.message.trim();
  }

  if (typeof evt.code === "string" && evt.code.trim()) {
    return evt.code.trim();
  }

  return undefined;
}

export type BridgeProbeParseResult = {
  reply?: string;
  upstreamError?: string;
};

export type BridgeTextDeltaHandler = (delta: string, text: string) => void;

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

function resolveBridgeForwardContext(ctx: BridgeForwardContext): BridgeForwardContext {
  const body = applyProxyCchToAnthropicMessagesBody(ctx.body, {
    ...(isProxyCchAuditEnabled()
      ? {
          onAudit: (phase, audit) => {
            logUpstream("proxy-cch-audit", {
              phase,
              role: ctx.route.role,
              apiCompat: ctx.route.apiCompat,
              model: ctx.route.modelId,
              ...(ctx.requestedModel && { requestedModel: ctx.requestedModel }),
              hitCount: audit.hitCount,
              uniqueCchValues: audit.uniqueCchValues,
              billingHeaderInSystem: audit.billingHeaderInSystem,
              hits: audit.hits,
              hint:
                phase === "upstream"
                  ? audit.hitCount === 0
                    ? "normalize 后上游 body 无 cch="
                    : "normalize 后仍有 cch=，检查规则"
                  : audit.hitCount === 0
                    ? "未在 SDK 请求体中发现 cch= / billing header"
                    : "若 uniqueCchValues 每轮变化，可能导致 prompt cache 失效",
            });
          },
        }
      : {}),
  });
  if (body === ctx.body) {
    return ctx;
  }
  return { ...ctx, body };
}

/**
 * @deprecated Production Claude SDK and product auxiliary do not use this path
 * (Bridge → embedded Gateway). Kept for provider connectivity probe helpers and
 * legacy goldens only; do not add new production callers (plan 3B).
 */
export async function forwardMessagesViaBridge(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  ctx: BridgeForwardContext,
): Promise<void> {
  const forwardCtx = resolveBridgeForwardContext(ctx);

  if (forwardCtx.route.apiCompat === "anthropic") {
    return forwardAnthropicNativeMessages(request, response, forwardCtx);
  }
  if (forwardCtx.route.apiCompat === "openai_chat_completions") {
    return forwardOpenAIChatCompletionsMessages(request, response, forwardCtx);
  }
  return forwardOpenAIResponsesMessages(request, response, forwardCtx);
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
    route.provider.version,
  );
  const upstreamBody = buildBridgeUpstreamMessagesPayload(
    route.apiCompat,
    anthropicRequest,
    route.modelId,
    stream,
    route.maxOutputTokens,
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
  logBridgeMessagesShape({
    ctx,
    operation: "messages",
    upstreamUrl,
    stream,
    converted: false,
    upstreamBody,
  });

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
    notifyBridgeProxyFailure(ctx, message);
    throw error;
  }

  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const isEventStream = contentType.includes("text/event-stream");
  const requestId =
    upstreamResponse.headers.get("x-request-id") ?? upstreamResponse.headers.get("request-id") ?? undefined;
  if (requestId) {
    ctx.onUpstreamRequestId?.(requestId);
  }

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
    notifyBridgeProxyFailure(
      ctx,
      responseText.trim().slice(0, 500) || upstreamResponse.statusText || String(upstreamResponse.status),
      upstreamResponse.status,
    );
    response.writeHead(upstreamResponse.status, {
      "content-type": contentType || "application/json",
    });
    response.end(responseText);
    return;
  }

  if (!isEventStream) {
    const responseText = await upstreamResponse.text();
    let usage: ParsedUsage | null = null;
    let downstreamMessageId: string | undefined;
    try {
      const responseBody = JSON.parse(responseText) as unknown;
      usage = extractUsageFromResponseBody(responseBody);
      if (responseBody && typeof responseBody === "object" && "id" in responseBody) {
        const id = (responseBody as { id?: unknown }).id;
        downstreamMessageId = typeof id === "string" && id.trim() ? id.trim() : undefined;
      }
    } catch {
      usage = null;
    }
    const billing = usage
      ? await resolveProxyCallBilling(
          onUsage,
          buildBridgeUsageInfo(route, usage, requestedModel, requestId, downstreamMessageId),
        )
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
      ? await resolveProxyCallBilling(
          onUsage,
          buildBridgeUsageInfo(route, usage, requestedModel, requestId, usageTracker.downstreamMessageId()),
        )
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
    route.provider.version,
  );
  let upstreamBody = buildBridgeUpstreamMessagesPayload(
    route.apiCompat,
    anthropicRequest,
    route.modelId,
    stream,
    route.maxOutputTokens,
  );
  applyResponsesRoutingHints(upstreamBody, {
    providerBaseUrl: route.provider.baseUrl,
    ...(ctx.threadId && { threadId: ctx.threadId }),
  });
  let requestPayload = JSON.stringify(upstreamBody);
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
  logBridgeMessagesShape({
    ctx,
    operation: "messages",
    upstreamUrl,
    stream,
    converted: true,
    upstreamBody,
  });

  let upstreamResponse: Response;
  let upstreamResponseText: string | undefined;
  try {
    const signal = (request as http.IncomingMessage & { signal?: AbortSignal }).signal;
    const result = await postJsonWithOpenAIResponsesUnsupportedParameterRetry({
      fetcher: fetch,
      url: upstreamUrl,
      headers: upstreamHeaders,
      body: upstreamBody,
      ...(signal && { signal }),
      logContext: {
        role: route.role,
        providerId: route.provider.id,
        provider: route.provider.name,
        modelId: route.modelId,
        apiCompat: route.apiCompat,
        ...(ctx.threadId && { threadId: ctx.threadId }),
      },
    });
    upstreamResponse = result.response;
    upstreamBody = result.requestBody;
    requestPayload = result.requestPayload;
    upstreamResponseText = result.responseText;
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
    notifyBridgeProxyFailure(ctx, message);
    throw error;
  }

  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const isEventStream = contentType.includes("text/event-stream");

  if (!upstreamResponse.ok) {
    const responseText = upstreamResponseText ?? (await upstreamResponse.text());
    logUpstreamProxyCall({
      at: new Date().toISOString(),
      ok: false,
      elapsedMs: Date.now() - startedAt,
      ...callCommon(),
      http: { status: upstreamResponse.status, streaming: stream },
      error: upstreamResponse.statusText || String(upstreamResponse.status),
      ...failureDebug(responseText),
    });
    notifyBridgeProxyFailure(
      ctx,
      responseText.trim().slice(0, 500) || upstreamResponse.statusText || String(upstreamResponse.status),
      upstreamResponse.status,
    );
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
      ? await resolveProxyCallBilling(
          onUsage,
          buildBridgeUsageInfo(route, usage, requestedModel, undefined, anthropicMessage.id),
        )
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
  const utf8Decoder = createStreamUtf8Decoder();

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
      sseBuffer = appendStreamUtf8Chunk(utf8Decoder, sseBuffer, chunk);
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

    sseBuffer = finalizeStreamUtf8Decoder(utf8Decoder, sseBuffer);
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
      ? await resolveProxyCallBilling(
          onUsage,
          buildBridgeUsageInfo(route, usage, requestedModel, undefined, usageTracker.downstreamMessageId()),
        )
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
    route.provider.version,
  );
  const upstreamBody = buildBridgeUpstreamMessagesPayload(
    route.apiCompat,
    anthropicRequest,
    route.modelId,
    stream,
    route.maxOutputTokens,
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
  logBridgeMessagesShape({
    ctx,
    operation: "messages",
    upstreamUrl,
    stream,
    converted: true,
    upstreamBody,
  });

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
    notifyBridgeProxyFailure(ctx, message);
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
    notifyBridgeProxyFailure(
      ctx,
      responseText.trim().slice(0, 500) || upstreamResponse.statusText || String(upstreamResponse.status),
      upstreamResponse.status,
    );
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
      ? await resolveProxyCallBilling(
          onUsage,
          buildBridgeUsageInfo(route, usage, requestedModel, undefined, anthropicMessage.id),
        )
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
  const utf8Decoder = createStreamUtf8Decoder();

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
      sseBuffer = appendStreamUtf8Chunk(utf8Decoder, sseBuffer, chunk);
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

    sseBuffer = finalizeStreamUtf8Decoder(utf8Decoder, sseBuffer);
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
      sseViolations.push(`流结束仍有未关闭的 content block: ${[...sseSequence.open].join(", ")}`);
    }

    const trackerUsage = usageTracker.finish();
    const usage = resolveChatCompletionsStreamUsage(trackerUsage, ccToResState.usage);
    const billing = usage
      ? await resolveProxyCallBilling(
          onUsage,
          buildBridgeUsageInfo(route, usage, requestedModel, undefined, usageTracker.downstreamMessageId()),
        )
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
  onTextDelta?: BridgeTextDeltaHandler;
}): Promise<BridgeProbeParseResult> {
  const contentType = params.response.headers.get("content-type") ?? "";
  const isEventStream = contentType.includes("text/event-stream");

  if (isEventStream && params.response.body) {
    return collectBridgeProbeStreamReply(params);
  }

  const raw = await params.response.text();
  const reply = parseBridgeProbeBufferedReply(raw, params.apiCompat, params.modelId, params.anthropicRequest);
  if (reply) {
    params.onTextDelta?.(reply, reply);
    return { reply };
  }
  const bufferedError = extractResponsesStreamEventErrorFromBody(raw);
  if (bufferedError) {
    return { upstreamError: bufferedError };
  }
  return {};
}

function extractResponsesStreamEventErrorFromBody(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as ResponsesStreamEvent;
    return extractResponsesStreamEventError(parsed);
  } catch {
    return undefined;
  }
}

async function collectBridgeProbeStreamReply(params: {
  apiCompat: UpstreamApiCompat;
  modelId: string;
  anthropicRequest: AnthropicRequest;
  response: Response;
  onTextDelta?: BridgeTextDeltaHandler;
}): Promise<BridgeProbeParseResult> {
  const toolNames = extractAnthropicRequestToolNames(params.anthropicRequest);
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const streamErrors: string[] = [];
  let sseBuffer = "";
  const utf8Decoder = createStreamUtf8Decoder();

  const pushText = (events: ReturnType<typeof responsesEventToAnthropicEvents>) => {
    for (const event of events) {
      if (event.type !== "content_block_delta" || !event.delta) {
        continue;
      }
      if (event.delta.type === "text_delta" && event.delta.text) {
        textParts.push(event.delta.text);
        params.onTextDelta?.(event.delta.text, textParts.join(""));
      }
      if (event.delta.type === "thinking_delta" && event.delta.thinking) {
        thinkingParts.push(event.delta.thinking);
      }
    }
  };

  if (params.apiCompat === "openai_responses") {
    const state = newResponsesEventToAnthropicState(toolNames);
    for await (const chunk of params.response.body as AsyncIterable<Uint8Array>) {
      sseBuffer = appendStreamUtf8Chunk(utf8Decoder, sseBuffer, chunk);
      const { blocks, remainder } = splitSseBlocks(sseBuffer);
      sseBuffer = remainder;
      for (const block of blocks) {
        const responsesEvent = parseResponsesStreamEventBlock(block);
        if (!responsesEvent) {
          continue;
        }
        const streamError = extractResponsesStreamEventError(responsesEvent);
        if (streamError) {
          streamErrors.push(streamError);
        }
        pushText(responsesEventToAnthropicEvents(responsesEvent, state));
      }
    }
    sseBuffer = finalizeStreamUtf8Decoder(utf8Decoder, sseBuffer);
    if (sseBuffer.trim()) {
      const { blocks } = splitSseBlocks(`${sseBuffer}\n\n`);
      for (const block of blocks) {
        const responsesEvent = parseResponsesStreamEventBlock(block);
        if (responsesEvent) {
          const streamError = extractResponsesStreamEventError(responsesEvent);
          if (streamError) {
            streamErrors.push(streamError);
          }
          pushText(responsesEventToAnthropicEvents(responsesEvent, state));
        }
      }
    }
    pushText(finalizeResponsesAnthropicStream(state));
  } else if (params.apiCompat === "openai_chat_completions") {
    const ccState = newChatCompletionsToResponsesStreamState(params.modelId);
    const anthropicState = newResponsesEventToAnthropicState(toolNames);
    for await (const chunk of params.response.body as AsyncIterable<Uint8Array>) {
      sseBuffer = appendStreamUtf8Chunk(utf8Decoder, sseBuffer, chunk);
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
    sseBuffer = finalizeStreamUtf8Decoder(utf8Decoder, sseBuffer);
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
      sseBuffer = appendStreamUtf8Chunk(utf8Decoder, sseBuffer, chunk);
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
    sseBuffer = finalizeStreamUtf8Decoder(utf8Decoder, sseBuffer);
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
    return { reply: text };
  }
  const thinking = thinkingParts.join("").trim();
  if (thinking) {
    return { reply: thinking };
  }
  const upstreamError = streamErrors.at(-1);
  if (upstreamError) {
    return { upstreamError };
  }
  return {};
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
