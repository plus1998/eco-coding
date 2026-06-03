import { jsonMarshal, jsonParse } from './json.js';
import type {
  AnthropicContentBlock,
  AnthropicImageSource,
  AnthropicMessage,
  AnthropicOutputConfig,
  AnthropicRequest,
  AnthropicThinking,
  AnthropicTool,
  ResponsesContentPart,
  ResponsesInputItem,
  ResponsesRequest,
  ResponsesTool,
} from './types.js';

export function responsesToAnthropicRequest(
  req: ResponsesRequest,
): AnthropicRequest {
  const { system, messages, err } = convertResponsesInputToAnthropic(req.input);
  if (err !== undefined) {
    throw err;
  }

  const out: AnthropicRequest = {
    model: req.model,
    messages,
    max_tokens: 8192,
    temperature: req.temperature,
    top_p: req.top_p,
    stream: req.stream,
  };

  if (system !== undefined) {
    out.system = system;
  }

  if (req.max_output_tokens !== undefined && req.max_output_tokens > 0) {
    out.max_tokens = req.max_output_tokens;
  }

  if (req.tools !== undefined && req.tools.length > 0) {
    out.tools = convertResponsesToAnthropicTools(req.tools);
  }

  if (req.tool_choice !== undefined) {
    const tc = convertResponsesToAnthropicToolChoice(req.tool_choice);
    if (tc.err !== undefined) {
      throw new Error(`convert tool_choice: ${tc.err.message}`);
    }
    if (tc.value !== undefined) {
      out.tool_choice = tc.value;
    }
  }

  if (req.reasoning !== undefined && req.reasoning.effort !== '') {
    const effort = mapResponsesEffortToAnthropic(req.reasoning.effort);
    out.output_config = { effort } satisfies AnthropicOutputConfig;
    if (effort !== 'low') {
      out.thinking = {
        type: 'enabled',
        budget_tokens: defaultThinkingBudget(effort),
      } satisfies AnthropicThinking;
    }
  }

  return out;
}

export function defaultThinkingBudget(effort: string): number {
  switch (effort) {
    case 'low':
      return 1024;
    case 'medium':
      return 4096;
    case 'high':
      return 10240;
    case 'max':
      return 32768;
    default:
      return 10240;
  }
}

export function mapResponsesEffortToAnthropic(effort: string): string {
  if (effort === 'xhigh') {
    return 'max';
  }
  return effort;
}

function convertResponsesInputToAnthropic(inputRaw: unknown): {
  system: unknown | undefined;
  messages: AnthropicMessage[];
  err: Error | undefined;
} {
  const serialized =
    typeof inputRaw === 'string' ? inputRaw : jsonMarshal(inputRaw);

  try {
    const asString = jsonParse(serialized) as unknown;
    if (typeof asString === 'string') {
      const content = jsonMarshal(asString);
      return {
        system: undefined,
        messages: [{ role: 'user', content }],
        err: undefined,
      };
    }
  } catch {
    /* not a JSON string literal */
  }

  let items: ResponsesInputItem[];
  try {
    const parsed = jsonParse(serialized) as unknown;
    if (typeof parsed === 'string') {
      const content = jsonMarshal(parsed);
      return {
        system: undefined,
        messages: [{ role: 'user', content }],
        err: undefined,
      };
    }
    if (!Array.isArray(parsed)) {
      return {
        system: undefined,
        messages: [],
        err: new Error('parse responses input: expected array or string'),
      };
    }
    items = parsed as ResponsesInputItem[];
  } catch (e) {
    return {
      system: undefined,
      messages: [],
      err: new Error(
        `parse responses input: ${e instanceof Error ? e.message : String(e)}`,
      ),
    };
  }

  let system: unknown | undefined;
  const messages: AnthropicMessage[] = [];

  for (const item of items) {
    if (item.role === 'system') {
      const text = extractTextFromContent(item.content);
      if (text !== '') {
        system = jsonMarshal(text);
      }
    } else if (item.type === 'function_call') {
      let input: unknown = {};
      if (item.arguments !== undefined && item.arguments !== '') {
        input = jsonParse(item.arguments);
      }
      const block: AnthropicContentBlock = {
        type: 'tool_use',
        id: fromResponsesCallIdToAnthropic(item.call_id ?? ''),
        name: item.name,
        input,
      };
      const blockJSON = jsonMarshal([block]);
      messages.push({
        role: 'assistant',
        content: blockJSON,
      });
    } else if (item.type === 'function_call_output') {
      let outputContent = item.output ?? '';
      if (outputContent === '') {
        outputContent = '(empty)';
      }
      const contentJSON = jsonMarshal(outputContent);
      const block: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: fromResponsesCallIdToAnthropic(item.call_id ?? ''),
        content: contentJSON,
      };
      const blockJSON = jsonMarshal([block]);
      messages.push({
        role: 'user',
        content: blockJSON,
      });
    } else if (item.role === 'user') {
      const result = convertResponsesUserToAnthropicContent(item.content);
      if (result.err !== undefined) {
        return { system: undefined, messages: [], err: result.err };
      }
      messages.push({
        role: 'user',
        content: result.content,
      });
    } else if (item.role === 'assistant') {
      const result = convertResponsesAssistantToAnthropicContent(item.content);
      if (result.err !== undefined) {
        return { system: undefined, messages: [], err: result.err };
      }
      messages.push({
        role: 'assistant',
        content: result.content,
      });
    } else if (item.content !== undefined) {
      messages.push({
        role: 'user',
        content: item.content,
      });
    }
  }

  return {
    system,
    messages: mergeConsecutiveMessages(messages),
    err: undefined,
  };
}

export function extractTextFromContent(raw: unknown): string {
  if (raw === undefined || raw === null) {
    return '';
  }
  if (typeof raw === 'string') {
    try {
      const parsed = jsonParse(raw);
      if (typeof parsed === 'string') {
        return parsed;
      }
      return extractTextFromContent(parsed);
    } catch {
      return raw;
    }
  }
  if (typeof raw === 'string') {
    return raw;
  }
  const parts = raw as ResponsesContentPart[];
  if (Array.isArray(parts)) {
    const texts: string[] = [];
    for (const p of parts) {
      if (
        (p.type === 'input_text' ||
          p.type === 'output_text' ||
          p.type === 'text') &&
        p.text !== ''
      ) {
        texts.push(p.text ?? '');
      }
    }
    return texts.join('\n\n');
  }
  try {
    const s = jsonMarshal(raw);
    const parsed = jsonParse(s);
    if (typeof parsed === 'string') {
      return parsed;
    }
    if (Array.isArray(parsed)) {
      return extractTextFromContent(parsed);
    }
  } catch {
    /* ignore */
  }
  return '';
}

function convertResponsesUserToAnthropicContent(raw: unknown): {
  content: unknown;
  err: Error | undefined;
} {
  if (raw === undefined || raw === null) {
    return { content: jsonMarshal(''), err: undefined };
  }

  if (typeof raw === 'string') {
    try {
      const parsed = jsonParse(raw);
      if (typeof parsed === 'string') {
        return { content: jsonMarshal(parsed), err: undefined };
      }
      return convertResponsesUserToAnthropicContent(parsed);
    } catch {
      return { content: jsonMarshal(raw), err: undefined };
    }
  }

  let parts: ResponsesContentPart[];
  try {
    const serialized = typeof raw === 'string' ? raw : jsonMarshal(raw);
    const parsed = jsonParse(serialized);
    if (typeof parsed === 'string') {
      return { content: jsonMarshal(parsed), err: undefined };
    }
    if (!Array.isArray(parsed)) {
      return { content: raw, err: undefined };
    }
    parts = parsed as unknown as ResponsesContentPart[];
  } catch {
    return { content: raw, err: undefined };
  }

  const blocks: AnthropicContentBlock[] = [];
  for (const p of parts) {
    switch (p.type) {
      case 'input_text':
      case 'text':
        if (p.text !== '') {
          blocks.push({ type: 'text', text: p.text });
        }
        break;
      case 'input_image': {
        const src = dataUriToAnthropicImageSource(p.image_url ?? '');
        if (src !== undefined) {
          blocks.push({ type: 'image', source: src });
        }
        break;
      }
    }
  }

  if (blocks.length === 0) {
    return { content: jsonMarshal(''), err: undefined };
  }
  return { content: jsonMarshal(blocks), err: undefined };
}

function convertResponsesAssistantToAnthropicContent(raw: unknown): {
  content: unknown;
  err: Error | undefined;
} {
  if (raw === undefined || raw === null) {
    return {
      content: jsonMarshal([{ type: 'text', text: '' }]),
      err: undefined,
    };
  }

  if (typeof raw === 'string') {
    try {
      const parsed = jsonParse(raw);
      if (typeof parsed === 'string') {
        return {
          content: jsonMarshal([{ type: 'text', text: parsed }]),
          err: undefined,
        };
      }
      return convertResponsesAssistantToAnthropicContent(parsed);
    } catch {
      return {
        content: jsonMarshal([{ type: 'text', text: raw }]),
        err: undefined,
      };
    }
  }

  let parts: ResponsesContentPart[];
  try {
    const serialized = typeof raw === 'string' ? raw : jsonMarshal(raw);
    const parsed = jsonParse(serialized);
    if (typeof parsed === 'string') {
      return {
        content: jsonMarshal([{ type: 'text', text: parsed }]),
        err: undefined,
      };
    }
    if (!Array.isArray(parsed)) {
      return { content: raw, err: undefined };
    }
    parts = parsed as unknown as ResponsesContentPart[];
  } catch {
    return { content: raw, err: undefined };
  }

  const blocks: AnthropicContentBlock[] = [];
  for (const p of parts) {
    switch (p.type) {
      case 'output_text':
      case 'text':
        if (p.text !== '') {
          blocks.push({ type: 'text', text: p.text });
        }
        break;
    }
  }

  if (blocks.length === 0) {
    blocks.push({ type: 'text', text: '' });
  }
  return { content: jsonMarshal(blocks), err: undefined };
}

export function fromResponsesCallIdToAnthropic(id: string): string {
  if (id.startsWith('fc_')) {
    const after = id.slice(3);
    if (after.startsWith('toolu_') || after.startsWith('call_')) {
      return after;
    }
  }
  if (!id.startsWith('toolu_') && !id.startsWith('call_')) {
    return `toolu_${id}`;
  }
  return id;
}

export function dataUriToAnthropicImageSource(
  dataUri: string,
): AnthropicImageSource | undefined {
  if (!dataUri.startsWith('data:')) {
    return undefined;
  }
  let rest = dataUri.slice(5);
  const semicolonIdx = rest.indexOf(';');
  if (semicolonIdx < 0) {
    return undefined;
  }
  const mediaType = rest.slice(0, semicolonIdx);
  rest = rest.slice(semicolonIdx + 1);
  if (!rest.startsWith('base64,')) {
    return undefined;
  }
  const data = rest.slice(7);
  return {
    type: 'base64',
    media_type: mediaType,
    data,
  };
}

export function mergeConsecutiveMessages(
  messages: AnthropicMessage[],
): AnthropicMessage[] {
  if (messages.length <= 1) {
    return messages;
  }

  const merged: AnthropicMessage[] = [];
  for (const msg of messages) {
    if (merged.length === 0 || merged[merged.length - 1]?.role !== msg.role) {
      merged.push(msg);
      continue;
    }

    const last = merged[merged.length - 1];
    if (last === undefined) {
      continue;
    }
    const lastBlocks = parseContentBlocks(last.content);
    const newBlocks = parseContentBlocks(msg.content);
    const combined = [...lastBlocks, ...newBlocks];
    last.content = jsonMarshal(combined);
  }
  return merged;
}

export function parseContentBlocks(raw: unknown): AnthropicContentBlock[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  try {
    const serialized = typeof raw === 'string' ? raw : jsonMarshal(raw);
    const parsed = jsonParse(serialized);
    if (Array.isArray(parsed)) {
      return parsed as unknown as AnthropicContentBlock[];
    }
    if (typeof parsed === 'string') {
      return [{ type: 'text', text: parsed }];
    }
  } catch {
    /* fall through */
  }
  if (typeof raw === 'string') {
    return [{ type: 'text', text: raw }];
  }
  return [];
}

function convertResponsesToAnthropicTools(
  tools: ResponsesTool[],
): AnthropicTool[] {
  const out: AnthropicTool[] = [];
  for (const t of tools) {
    switch (t.type) {
      case 'web_search':
      case 'google_search':
      case 'web_search_20250305':
        out.push({
          type: 'web_search_20250305',
          name: 'web_search',
          input_schema: {},
        });
        break;
      case 'function':
        out.push({
          name: t.name ?? '',
          description: t.description,
          input_schema: normalizeAnthropicInputSchema(t.parameters),
        });
        break;
      default:
        out.push({
          type: t.type,
          name: t.name ?? '',
          description: t.description,
          input_schema: t.parameters ?? {},
        });
    }
  }
  return out;
}

function normalizeAnthropicInputSchema(schema: unknown): unknown {
  if (
    schema === undefined ||
    schema === null ||
    jsonMarshal(schema) === 'null'
  ) {
    return { type: 'object', properties: {} };
  }
  return schema;
}

function convertResponsesToAnthropicToolChoice(raw: unknown): {
  value: unknown | undefined;
  err: Error | undefined;
} {
  if (typeof raw === 'string') {
    try {
      const parsed = jsonParse(raw);
      return convertResponsesToAnthropicToolChoice(parsed);
    } catch {
      /* use as string below */
    }
  }

  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = jsonParse(raw);
    } catch {
      value = raw;
    }
  }

  if (typeof value === 'string') {
    switch (value) {
      case 'auto':
        return { value: { type: 'auto' }, err: undefined };
      case 'required':
        return { value: { type: 'any' }, err: undefined };
      case 'none':
        return { value: { type: 'none' }, err: undefined };
      default:
        return { value: raw, err: undefined };
    }
  }

  const tc = value as {
    type?: string;
    name?: string;
    function?: { name?: string };
  };
  if (tc.type === 'function') {
    let name = (tc.name ?? '').trim();
    if (name === '') {
      name = (tc.function?.name ?? '').trim();
    }
    if (name === '') {
      return { value: raw, err: undefined };
    }
    return { value: { type: 'tool', name }, err: undefined };
  }

  return { value: raw, err: undefined };
}
