import { isReasoningModel, minMaxOutputTokens } from './anthropic-to-responses.js';
import { jsonMarshal, jsonParse } from './json.js';
import type {
  ChatCompletionsRequest,
  ChatContentPart,
  ChatFunction,
  ChatMessage,
  ChatTool,
  ResponsesContentPart,
  ResponsesInputItem,
  ResponsesReasoning,
  ResponsesRequest,
  ResponsesTool,
} from './types.js';

interface ChatMessageContent {
  text?: string;
  parts?: ChatContentPart[];
}

export function chatCompletionsToResponses(
  req: ChatCompletionsRequest,
): ResponsesRequest {
  const input = convertChatMessagesToResponsesInput(req.messages);

  const out: ResponsesRequest = {
    model: req.model,
    instructions: req.instructions,
    input: jsonMarshal(input),
    stream: req.stream ?? false,
    include: ['reasoning.encrypted_content'],
    service_tier: req.service_tier,
  };

  if (!isReasoningModel(req.model)) {
    out.temperature = req.temperature;
    out.top_p = req.top_p;
  }

  out.store = false;

  let maxTokens = 0;
  if (req.max_tokens !== undefined) {
    maxTokens = req.max_tokens;
  }
  if (req.max_completion_tokens !== undefined) {
    maxTokens = req.max_completion_tokens;
  }
  if (maxTokens > 0) {
    let v = maxTokens;
    if (v < minMaxOutputTokens) {
      v = minMaxOutputTokens;
    }
    out.max_output_tokens = v;
  }

  if (req.reasoning_effort !== undefined && req.reasoning_effort !== '') {
    out.reasoning = {
      effort: req.reasoning_effort,
      summary: 'auto',
    } satisfies ResponsesReasoning;
  }

  const tools = req.tools ?? [];
  const functions = req.functions ?? [];
  if (tools.length > 0 || functions.length > 0) {
    out.tools = convertChatToolsToResponses(tools, functions);
  }

  if (req.tool_choice !== undefined) {
    out.tool_choice = req.tool_choice;
  } else if (req.function_call !== undefined) {
    out.tool_choice = convertChatFunctionCallToToolChoice(req.function_call);
  }

  return out;
}

function convertChatMessagesToResponsesInput(
  msgs: ChatMessage[],
): ResponsesInputItem[] {
  const out: ResponsesInputItem[] = [];
  for (const m of msgs) {
    out.push(...chatMessageToResponsesItems(m));
  }
  return out;
}

function chatMessageToResponsesItems(m: ChatMessage): ResponsesInputItem[] {
  switch (m.role) {
    case 'system':
      return chatSystemToResponses(m);
    case 'user':
      return chatUserToResponses(m);
    case 'assistant':
      return chatAssistantToResponses(m);
    case 'tool':
      return chatToolToResponses(m);
    case 'function':
      return chatFunctionToResponses(m);
    default:
      return chatUserToResponses(m);
  }
}

function chatSystemToResponses(m: ChatMessage): ResponsesInputItem[] {
  const parsed = parseChatMessageContent(m.content);
  const content = marshalChatInputContent(parsed);
  return [{ role: 'system', content }];
}

function chatUserToResponses(m: ChatMessage): ResponsesInputItem[] {
  const parsed = parseChatMessageContent(m.content);
  const content = marshalChatInputContent(parsed);
  return [{ role: 'user', content }];
}

function chatAssistantToResponses(m: ChatMessage): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];
  let content = '';

  if (m.reasoning_content !== undefined && m.reasoning_content !== '') {
    content = `<thinking>${m.reasoning_content}</thinking>`;
  }

  if (m.content !== undefined) {
    const s = parseAssistantContent(m.content);
    if (s !== '') {
      if (content !== '') {
        content += '\n';
      }
      content += s;
    }
  }

  if (content !== '') {
    const parts: ResponsesContentPart[] = [
      { type: 'output_text', text: content },
    ];
    items.push({
      role: 'assistant',
      content: jsonMarshal(parts),
    });
  }

  for (const tc of m.tool_calls ?? []) {
    let args = tc.function.arguments;
    if (args === '') {
      args = '{}';
    }
    items.push({
      type: 'function_call',
      call_id: tc.id,
      name: tc.function.name,
      arguments: args,
    });
  }

  return items;
}

function parseAssistantContent(raw: unknown): string {
  if (raw === undefined || raw === null) {
    return '';
  }

  const serialized = typeof raw === 'string' ? raw : jsonMarshal(raw);
  try {
    const parsed = jsonParse(serialized);
    if (typeof parsed === 'string') {
      return parsed;
    }
    if (!Array.isArray(parsed)) {
      return '';
    }
    const parts = parsed as Record<string, unknown>[];
    let result = '';
    for (const p of parts) {
      const typ = typeof p.type === 'string' ? p.type : '';
      const text = typeof p.text === 'string' ? p.text : '';
      const thinking =
        typeof p.thinking === 'string' ? p.thinking : '';

      switch (typ) {
        case 'thinking':
        case 'reasoning':
          if (thinking !== '') {
            result += `<thinking>${thinking}</thinking>`;
          } else if (text !== '') {
            result += `<thinking>${text}</thinking>`;
          }
          break;
        default:
          if (text !== '') {
            result += text;
          }
      }
    }
    return result;
  } catch {
    return '';
  }
}

function chatToolToResponses(m: ChatMessage): ResponsesInputItem[] {
  let output = parseChatContent(m.content);
  if (output === '') {
    output = '(empty)';
  }
  return [
    {
      type: 'function_call_output',
      call_id: m.tool_call_id ?? '',
      output,
    },
  ];
}

function chatFunctionToResponses(m: ChatMessage): ResponsesInputItem[] {
  let output = parseChatContent(m.content);
  if (output === '') {
    output = '(empty)';
  }
  return [
    {
      type: 'function_call_output',
      call_id: m.name ?? '',
      output,
    },
  ];
}

function parseChatContent(raw: unknown): string {
  const parsed = parseChatMessageContent(raw);
  if (parsed.text !== undefined) {
    return parsed.text;
  }
  return flattenChatContentParts(parsed.parts ?? []);
}

function parseChatMessageContent(raw: unknown): ChatMessageContent {
  if (raw === undefined || raw === null) {
    return { text: '' };
  }

  if (typeof raw === 'string') {
    try {
      const parsed = jsonParse(raw);
      if (typeof parsed === 'string') {
        return { text: parsed };
      }
      if (Array.isArray(parsed)) {
        return { parts: parsed as unknown as ChatContentPart[] };
      }
    } catch {
      return { text: raw };
    }
    return { text: raw };
  }

  if (Array.isArray(raw)) {
    return { parts: raw as ChatContentPart[] };
  }

  throw new Error('parse content as string or parts array');
}

function marshalChatInputContent(content: ChatMessageContent): unknown {
  if (content.text !== undefined) {
    return jsonMarshal(content.text);
  }
  const parts = convertChatContentPartsToResponses(content.parts ?? []);
  if (parts.length === 0) {
    return jsonMarshal('');
  }
  return jsonMarshal(parts);
}

function convertChatContentPartsToResponses(
  parts: ChatContentPart[],
): ResponsesContentPart[] {
  const responseParts: ResponsesContentPart[] = [];
  for (const p of parts) {
    switch (p.type) {
      case 'text':
        if (p.text !== '') {
          responseParts.push({ type: 'input_text', text: p.text });
        }
        break;
      case 'image_url':
        if (
          p.image_url !== undefined &&
          p.image_url.url !== '' &&
          !isEmptyBase64DataUri(p.image_url.url)
        ) {
          responseParts.push({
            type: 'input_image',
            image_url: p.image_url.url,
          });
        }
        break;
    }
  }
  return responseParts;
}

function isEmptyBase64DataUri(raw: string): boolean {
  if (!raw.startsWith('data:')) {
    return false;
  }
  let rest = raw.slice(5);
  const semicolonIdx = rest.indexOf(';');
  if (semicolonIdx < 0) {
    return false;
  }
  rest = rest.slice(semicolonIdx + 1);
  if (!rest.startsWith('base64,')) {
    return false;
  }
  const payload = rest.slice(7).trim();
  return payload === '';
}

function flattenChatContentParts(parts: ChatContentPart[]): string {
  const textParts: string[] = [];
  for (const p of parts) {
    if (p.type === 'text' && p.text !== '') {
      textParts.push(p.text ?? '');
    }
  }
  return textParts.join('');
}

function convertChatToolsToResponses(
  tools: ChatTool[],
  functions: ChatFunction[],
): ResponsesTool[] {
  const out: ResponsesTool[] = [];

  for (const t of tools) {
    if (t.type !== 'function' || t.function === undefined) {
      continue;
    }
    out.push({
      type: 'function',
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
      strict: t.function.strict,
    });
  }

  for (const f of functions) {
    out.push({
      type: 'function',
      name: f.name,
      description: f.description,
      parameters: f.parameters,
      strict: f.strict,
    });
  }

  return out;
}

function convertChatFunctionCallToToolChoice(raw: unknown): unknown {
  const serialized = typeof raw === 'string' ? raw : jsonMarshal(raw);
  try {
    const parsed = jsonParse(serialized);
    if (typeof parsed === 'string') {
      return jsonMarshal(parsed);
    }
    const obj = parsed as { name?: string };
    return jsonMarshal({
      type: 'function',
      name: obj.name,
    });
  } catch (e) {
    throw new Error(
      `convert function_call: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
