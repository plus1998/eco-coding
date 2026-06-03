import { jsonMarshal, jsonParse, type JsonValue } from './json.js';
import type {
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicRequest,
  AnthropicTool,
  ResponsesContentPart,
  ResponsesInputItem,
  ResponsesReasoning,
  ResponsesRequest,
  ResponsesText,
  ResponsesTool,
} from './types.js';

/** Floor for max_output_tokens in Responses requests (matches Go minMaxOutputTokens). */
export const minMaxOutputTokens = 128;

export function toResponsesCallID(id: string): string {
  return id;
}

export function fromResponsesCallID(id: string): string {
  if (id.startsWith('fc_')) {
    const after = id.slice(3);
    if (after.startsWith('toolu_') || after.startsWith('call_')) {
      return after;
    }
  }
  return id;
}

export function mapAnthropicEffortToResponses(effort: string): string {
  if (effort === 'max') {
    return 'xhigh';
  }
  return effort;
}

export function isAnthropicBillingHeaderText(text: string): boolean {
  return text.startsWith('x-anthropic-billing-header: ');
}

export function anthropicImageToDataURI(src: {
  media_type?: string;
  data?: string;
} | undefined): string {
  if (src === undefined || src.data === '') {
    return '';
  }
  let mediaType = src.media_type ?? '';
  if (mediaType === '') {
    mediaType = 'image/png';
  }
  return `data:${mediaType};base64,${src.data}`;
}

export function isReasoningModel(model: string): boolean {
  return model.startsWith('gpt-5');
}

export function normalizeToolParameters(schema: unknown): unknown {
  if (
    schema === undefined ||
    schema === null ||
    jsonMarshal(schema) === 'null'
  ) {
    return { type: 'object', properties: {} };
  }

  let m: Record<string, JsonValue>;
  try {
    const parsed = typeof schema === 'string' ? jsonParse(schema) : schema;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return schema;
    }
    m = parsed as Record<string, JsonValue>;
  } catch {
    return schema;
  }

  if (m.type !== 'object') {
    return schema;
  }

  if ('properties' in m) {
    return schema;
  }

  return { ...m, properties: {} };
}

/** Map Anthropic thinking/effort fields to OpenAI Responses reasoning, when enabled. */
export function resolveAnthropicReasoningForResponses(
  req: AnthropicRequest,
): ResponsesReasoning | undefined {
  if (req.thinking?.type === 'disabled') {
    return undefined;
  }

  let effort: string | undefined;
  if (req.output_config?.effort !== undefined && req.output_config.effort !== '') {
    effort = req.output_config.effort;
  } else if (req.effort !== undefined && req.effort !== '') {
    effort = req.effort;
  }

  if (effort === undefined) {
    return undefined;
  }

  return {
    effort: mapAnthropicEffortToResponses(effort),
    summary: 'auto',
  };
}

export function anthropicToResponses(req: AnthropicRequest): ResponsesRequest {
  const input = convertAnthropicToResponsesInput(req.system, req.messages);

  const out: ResponsesRequest = {
    model: req.model,
    input: jsonMarshal(input),
    stream: req.stream ?? false,
    include: ['reasoning.encrypted_content'],
  };

  if (!isReasoningModel(req.model)) {
    out.temperature = req.temperature;
    out.top_p = req.top_p;
  }

  out.store = false;
  out.parallel_tool_calls = true;
  out.text = { verbosity: 'medium' };

  if (req.max_tokens > 0) {
    let v = req.max_tokens;
    if (v < minMaxOutputTokens) {
      v = minMaxOutputTokens;
    }
    out.max_output_tokens = v;
  }

  if (req.tools !== undefined && req.tools.length > 0) {
    out.tools = convertAnthropicToolsToResponses(req.tools);
  }

  const reasoning = resolveAnthropicReasoningForResponses(req);
  if (reasoning !== undefined) {
    out.reasoning = reasoning;
  }

  if (req.tool_choice !== undefined) {
    out.tool_choice = convertAnthropicToolChoiceToResponses(req.tool_choice);
  }

  return out;
}

export function convertAnthropicToolChoiceToResponses(raw: unknown): unknown {
  const tc = raw as { type?: string; name?: string };
  switch (tc.type) {
    case 'auto':
      return 'auto';
    case 'any':
      return 'required';
    case 'none':
      return 'none';
    case 'tool':
      return { type: 'function', name: tc.name };
    default:
      return raw;
  }
}

export function convertAnthropicToResponsesInput(
  system: unknown,
  msgs: AnthropicMessage[],
): ResponsesInputItem[] {
  const out: ResponsesInputItem[] = [];

  if (system !== undefined && system !== null) {
    const sysParts = parseAnthropicSystemContentParts(system);
    if (sysParts.length > 0) {
      out.push({
        type: 'message',
        role: 'developer',
        content: jsonMarshal(sysParts),
      });
    }
  }

  for (const m of msgs) {
    out.push(...anthropicMsgToResponsesItems(m));
  }
  return out;
}

export function parseAnthropicSystemContentParts(raw: unknown): ResponsesContentPart[] {
  if (typeof raw === 'string') {
    if (isAnthropicBillingHeaderText(raw) || raw === '') {
      return [];
    }
    return [{ type: 'input_text', text: raw }];
  }
  const blocks = raw as AnthropicContentBlock[];
  const parts: ResponsesContentPart[] = [];
  for (const b of blocks) {
    if (b.type === 'text' && b.text !== undefined && b.text !== '' && !isAnthropicBillingHeaderText(b.text)) {
      parts.push({ type: 'input_text', text: b.text });
    }
  }
  return parts;
}

export function anthropicMsgToResponsesItems(m: AnthropicMessage): ResponsesInputItem[] {
  switch (m.role) {
    case 'user':
      return anthropicUserToResponses(m.content);
    case 'assistant':
      return anthropicAssistantToResponses(m.content);
    default:
      return anthropicUserToResponses(m.content);
  }
}

export function anthropicUserToResponses(raw: unknown): ResponsesInputItem[] {
  if (typeof raw === 'string') {
    const parts: ResponsesContentPart[] = [{ type: 'input_text', text: raw }];
    return [{ type: 'message', role: 'user', content: jsonMarshal(parts) }];
  }

  const blocks = raw as AnthropicContentBlock[];
  const out: ResponsesInputItem[] = [];
  let toolResultImageParts: ResponsesContentPart[] = [];

  for (const b of blocks) {
    if (b.type !== 'tool_result') {
      continue;
    }
    const { outputText, imageParts } = convertToolResultOutput(b);
    out.push({
      type: 'function_call_output',
      call_id: toResponsesCallID(b.tool_use_id ?? ''),
      output: outputText,
    });
    toolResultImageParts = toolResultImageParts.concat(imageParts);
  }

  const parts: ResponsesContentPart[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'text':
        if (b.text !== undefined && b.text !== '') {
          parts.push({ type: 'input_text', text: b.text });
        }
        break;
      case 'image': {
        const uri = anthropicImageToDataURI(b.source);
        if (uri !== '') {
          parts.push({ type: 'input_image', image_url: uri });
        }
        break;
      }
    }
  }
  parts.push(...toolResultImageParts);

  if (parts.length > 0) {
    out.push({ type: 'message', role: 'user', content: jsonMarshal(parts) });
  }

  return out;
}

export function anthropicAssistantToResponses(raw: unknown): ResponsesInputItem[] {
  if (typeof raw === 'string') {
    const parts: ResponsesContentPart[] = [{ type: 'output_text', text: raw }];
    return [{ type: 'message', role: 'assistant', content: jsonMarshal(parts) }];
  }

  const blocks = raw as AnthropicContentBlock[];
  const items: ResponsesInputItem[] = [];

  const text = extractAnthropicTextFromBlocks(blocks);
  if (text !== '') {
    const parts: ResponsesContentPart[] = [{ type: 'output_text', text }];
    items.push({ type: 'message', role: 'assistant', content: jsonMarshal(parts) });
  }

  for (const b of blocks) {
    if (b.type !== 'tool_use') {
      continue;
    }
    let args = '{}';
    if (b.input !== undefined) {
      args = typeof b.input === 'string' ? b.input : jsonMarshal(b.input);
    }
    items.push({
      type: 'function_call',
      call_id: toResponsesCallID(b.id ?? ''),
      name: b.name,
      arguments: args,
    });
  }

  return items;
}

export function convertToolResultOutput(b: AnthropicContentBlock): {
  outputText: string;
  imageParts: ResponsesContentPart[];
} {
  if (b.content === undefined || b.content === null) {
    return { outputText: '(empty)', imageParts: [] };
  }

  if (typeof b.content === 'string') {
    return { outputText: b.content === '' ? '(empty)' : b.content, imageParts: [] };
  }

  const inner = b.content as AnthropicContentBlock[];
  const textParts: string[] = [];
  const imageParts: ResponsesContentPart[] = [];
  for (const ib of inner) {
    switch (ib.type) {
      case 'text':
        if (ib.text !== undefined && ib.text !== '') {
          textParts.push(ib.text);
        }
        break;
      case 'image': {
        const uri = anthropicImageToDataURI(ib.source);
        if (uri !== '') {
          imageParts.push({ type: 'input_image', image_url: uri });
        }
        break;
      }
    }
  }

  let text = textParts.join('\n\n');
  if (text === '') {
    text = '(empty)';
  }
  return { outputText: text, imageParts };
}

export function extractAnthropicTextFromBlocks(blocks: AnthropicContentBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === 'text' && b.text !== undefined && b.text !== '') {
      parts.push(b.text);
    }
  }
  return parts.join('\n\n');
}

export function convertAnthropicToolsToResponses(tools: AnthropicTool[]): ResponsesTool[] {
  const out: ResponsesTool[] = [];
  for (const t of tools) {
    if (t.type !== undefined && t.type.startsWith('web_search')) {
      out.push({ type: 'web_search' });
      continue;
    }
    out.push({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: normalizeToolParameters(t.input_schema),
      strict: false,
    });
  }
  return out;
}
