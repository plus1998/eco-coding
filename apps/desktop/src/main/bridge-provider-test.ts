import {
  anthropicToResponses,
  chatCompletionsChunkToResponsesEvents,
  chatCompletionsResponseToResponses,
  extractAnthropicRequestToolNames,
  finalizeChatCompletionsResponsesStream,
  finalizeResponsesAnthropicStream,
  newChatCompletionsToResponsesStreamState,
  newResponsesEventToAnthropicState,
  responsesEventToAnthropicEvents,
  responsesToAnthropic,
  responsesToChatCompletionsRequest,
  type AnthropicRequest,
  type AnthropicStreamEvent,
  type ChatCompletionsChunk,
  type ChatCompletionsResponse,
  type ResponsesResponse,
  type ResponsesStreamEvent,
} from "@eco/openai-anthropic-bridge";
import { applyThinkingToMessagesBody } from "@eco/runtime";
import { isOpenAICompat, type UpstreamApiCompat } from "../shared/api-compat";
import type { ThinkingEffort } from "../shared/ipc";
import { ROUTE_TEST_THINKING_EFFORT } from "../shared/models";

const PROVIDER_TEST_MAX_TOKENS = 256;

export function buildBridgeProviderTestAnthropicRequest(
  modelId: string,
  thinkingEffort: ThinkingEffort = ROUTE_TEST_THINKING_EFFORT,
): AnthropicRequest {
  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: PROVIDER_TEST_MAX_TOKENS,
    messages: [{ role: "user", content: "hi" }],
  };
  applyThinkingToMessagesBody(body, thinkingEffort);
  return body as AnthropicRequest;
}

/** Same conversion chain as `model-upstream-openai` forwarders; OpenAI compat uses streaming. */
export function buildBridgeProviderTestUpstreamBody(
  apiCompat: UpstreamApiCompat,
  anthropicRequest: AnthropicRequest,
  modelId: string,
): { body: Record<string, unknown>; preferStream: boolean } {
  if (apiCompat === "anthropic") {
    return {
      body: { ...anthropicRequest, stream: false } as Record<string, unknown>,
      preferStream: false,
    };
  }

  const responsesReq = anthropicToResponses(anthropicRequest);
  responsesReq.model = modelId;
  responsesReq.stream = true;

  if (apiCompat === "openai_responses") {
    return { body: responsesReq as unknown as Record<string, unknown>, preferStream: true };
  }

  const chatReq = responsesToChatCompletionsRequest(responsesReq);
  chatReq.model = modelId;
  chatReq.stream = true;
  return { body: chatReq as unknown as Record<string, unknown>, preferStream: true };
}

export async function parseBridgeProviderTestReply(params: {
  apiCompat: UpstreamApiCompat;
  modelId: string;
  anthropicRequest: AnthropicRequest;
  response: Response;
}): Promise<string | undefined> {
  const contentType = params.response.headers.get("content-type") ?? "";
  const isEventStream = contentType.includes("text/event-stream");

  if (isOpenAICompat(params.apiCompat) && isEventStream && params.response.body) {
    return collectOpenAICompatStreamReply(params);
  }

  const raw = await params.response.text();
  return parseBridgeProviderTestBufferedReply(
    raw,
    params.apiCompat,
    params.modelId,
    params.anthropicRequest,
  );
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

function parseChatCompletionsChunkBlock(block: string): ChatCompletionsChunk | null {
  let data = "";
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      data = line.slice("data:".length).trimStart();
    }
  }
  if (!data || data === "[DONE]") {
    return null;
  }
  try {
    return JSON.parse(data) as ChatCompletionsChunk;
  } catch {
    return null;
  }
}

async function collectOpenAICompatStreamReply(params: {
  apiCompat: UpstreamApiCompat;
  modelId: string;
  anthropicRequest: AnthropicRequest;
  response: Response;
}): Promise<string | undefined> {
  const toolNames = extractAnthropicRequestToolNames(params.anthropicRequest);
  const anthropicEvents: AnthropicStreamEvent[] = [];

  const pushAnthropic = (events: AnthropicStreamEvent[]) => {
    anthropicEvents.push(...events);
  };

  let sseBuffer = "";

  if (params.apiCompat === "openai_responses") {
    const state = newResponsesEventToAnthropicState(toolNames);
    for await (const chunk of params.response.body as AsyncIterable<Uint8Array>) {
      sseBuffer += Buffer.from(chunk).toString("utf8");
      const { blocks, remainder } = splitSseBlocks(sseBuffer);
      sseBuffer = remainder;
      for (const block of blocks) {
        const responsesEvent = parseResponsesStreamEventBlock(block);
        if (!responsesEvent) {
          continue;
        }
        pushAnthropic(responsesEventToAnthropicEvents(responsesEvent, state));
      }
    }
    if (sseBuffer.trim()) {
      const { blocks } = splitSseBlocks(`${sseBuffer}\n\n`);
      for (const block of blocks) {
        const responsesEvent = parseResponsesStreamEventBlock(block);
        if (responsesEvent) {
          pushAnthropic(responsesEventToAnthropicEvents(responsesEvent, state));
        }
      }
    }
    pushAnthropic(finalizeResponsesAnthropicStream(state));
  } else {
    const ccToResState = newChatCompletionsToResponsesStreamState(params.modelId);
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
        for (const responsesEvent of chatCompletionsChunkToResponsesEvents(chatChunk, ccToResState)) {
          pushAnthropic(responsesEventToAnthropicEvents(responsesEvent, anthropicState));
        }
      }
    }
    if (sseBuffer.trim()) {
      const { blocks } = splitSseBlocks(`${sseBuffer}\n\n`);
      for (const block of blocks) {
        const chatChunk = parseChatCompletionsChunkBlock(block);
        if (!chatChunk) {
          continue;
        }
        for (const responsesEvent of chatCompletionsChunkToResponsesEvents(chatChunk, ccToResState)) {
          pushAnthropic(responsesEventToAnthropicEvents(responsesEvent, anthropicState));
        }
      }
    }
    for (const responsesEvent of finalizeChatCompletionsResponsesStream(ccToResState)) {
      pushAnthropic(responsesEventToAnthropicEvents(responsesEvent, anthropicState));
    }
    pushAnthropic(finalizeResponsesAnthropicStream(anthropicState));
  }

  return extractReplyFromAnthropicStreamEvents(anthropicEvents);
}

function extractReplyFromAnthropicStreamEvents(events: AnthropicStreamEvent[]): string | undefined {
  const textParts: string[] = [];
  const thinkingParts: string[] = [];

  for (const event of events) {
    if (event.type !== "content_block_delta" || !event.delta) {
      continue;
    }
    if (event.delta.type === "text_delta" && typeof event.delta.text === "string" && event.delta.text) {
      textParts.push(event.delta.text);
    }
    if (
      event.delta.type === "thinking_delta" &&
      typeof event.delta.thinking === "string" &&
      event.delta.thinking
    ) {
      thinkingParts.push(event.delta.thinking);
    }
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

function parseBridgeProviderTestBufferedReply(
  raw: string,
  apiCompat: UpstreamApiCompat,
  modelId: string,
  anthropicRequest: AnthropicRequest,
): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }

  if (apiCompat === "anthropic") {
    return extractAnthropicMessageReply(parsed);
  }

  const toolNames = extractAnthropicRequestToolNames(anthropicRequest);
  if (!isRecord(parsed)) {
    return undefined;
  }

  const responseModel = typeof parsed.model === "string" ? parsed.model : modelId;
  if (parsed.object === "response") {
    const anthropic = responsesToAnthropic(parsed as ResponsesResponse, responseModel, toolNames);
    return extractAnthropicMessageReply(anthropic);
  }
  if (Array.isArray(parsed.choices)) {
    const anthropic = responsesToAnthropic(
      chatCompletionsResponseToResponses(parsed as ChatCompletionsResponse),
      responseModel,
      toolNames,
    );
    return extractAnthropicMessageReply(anthropic);
  }

  return undefined;
}

function extractAnthropicMessageReply(body: unknown): string | undefined {
  if (!isRecord(body) || !Array.isArray(body.content)) {
    return undefined;
  }

  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  for (const block of body.content) {
    if (!isRecord(block)) {
      continue;
    }
    if (block.type === "text" && typeof block.text === "string") {
      const text = block.text.trim();
      if (text) {
        textParts.push(text);
      }
    }
    if (block.type === "thinking" && typeof block.thinking === "string") {
      const text = block.thinking.trim();
      if (text) {
        thinkingParts.push(text);
      }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
