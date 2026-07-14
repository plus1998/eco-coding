import { createHash } from 'node:crypto';

const THINK_OPEN_TAG = '<think>';
const THINK_CLOSE_TAG = '</think>';

export const CHAT_TOOL_NAME_MAX_LEN = 64;
export const TOOL_SEARCH_PROXY_NAME = 'tool_search';
export const CUSTOM_TOOL_INPUT_FIELD = 'input';

/** Deep-extract reasoning text from chat message/delta fields (CC Switch parity). */
export function extractReasoningFieldText(value: unknown): string | undefined {
  if (value === null || value === undefined || typeof value !== 'object') {
    return undefined;
  }
  const obj = value as Record<string, unknown>;

  for (const key of ['reasoning_content', 'reasoning'] as const) {
    const text = obj[key];
    if (typeof text === 'string' && text !== '') {
      return text;
    }
  }

  const reasoning = obj.reasoning;
  if (reasoning !== null && typeof reasoning === 'object' && !Array.isArray(reasoning)) {
    const reasoningObj = reasoning as Record<string, unknown>;
    for (const key of ['content', 'text', 'summary'] as const) {
      const text = reasoningObj[key];
      if (typeof text === 'string' && text !== '') {
        return text;
      }
    }
  }

  if (obj.reasoning_details !== undefined) {
    const text = extractReasoningDetailsText(obj.reasoning_details);
    if (text !== undefined) {
      return text;
    }
  }

  return undefined;
}

function extractReasoningDetailsText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value !== '' ? value : undefined;
  }
  if (Array.isArray(value)) {
    const text = value
      .map((part) => extractReasoningDetailPartText(part))
      .filter((part): part is string => part !== undefined && part !== '')
      .join('\n\n');
    return text !== '' ? text : undefined;
  }
  if (value !== null && typeof value === 'object') {
    return extractReasoningDetailPartText(value);
  }
  return undefined;
}

function extractReasoningDetailPartText(value: unknown): string | undefined {
  if (value === null || value === undefined || typeof value !== 'object') {
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  for (const key of ['text', 'content', 'summary'] as const) {
    const text = obj[key];
    if (typeof text === 'string' && text !== '') {
      return text;
    }
  }
  if (Array.isArray(obj.parts)) {
    const text = obj.parts
      .map((part) => extractReasoningDetailPartText(part))
      .filter((part): part is string => part !== undefined && part !== '')
      .join('\n\n');
    return text !== '' ? text : undefined;
  }
  return undefined;
}

export function splitLeadingThinkBlock(text: string): { reasoning: string; answer: string } | undefined {
  const leadingWsLen = text.length - text.trimStart().length;
  const afterWs = text.slice(leadingWsLen);
  if (!afterWs.startsWith(THINK_OPEN_TAG)) {
    return undefined;
  }

  const bodyStart = leadingWsLen + THINK_OPEN_TAG.length;
  const closeRelative = text.slice(bodyStart).indexOf(THINK_CLOSE_TAG);
  if (closeRelative < 0) {
    return undefined;
  }
  const closeStart = bodyStart + closeRelative;
  const answerStart = closeStart + THINK_CLOSE_TAG.length;

  return {
    reasoning: text.slice(bodyStart, closeStart).trim(),
    answer: stripThinkAnswerSeparator(text.slice(answerStart)),
  };
}

export function stripLeadingThinkOpenTag(text: string): string | undefined {
  const leadingWsLen = text.length - text.trimStart().length;
  const afterWs = text.slice(leadingWsLen);
  if (!afterWs.startsWith(THINK_OPEN_TAG)) {
    return undefined;
  }
  return afterWs.slice(THINK_OPEN_TAG.length).trim();
}

function stripThinkAnswerSeparator(text: string): string {
  return text.replace(/^[\r\n\t ]+/, '');
}

export type ThinkPrefixDecision = 'need_more' | 'reasoning' | 'text';

export function leadingThinkPrefixDecision(buffer: string): ThinkPrefixDecision {
  const trimmed = buffer.trimStart();
  if (trimmed === '') {
    return 'need_more';
  }
  if (trimmed.startsWith(THINK_OPEN_TAG)) {
    return 'reasoning';
  }
  if (THINK_OPEN_TAG.startsWith(trimmed)) {
    return 'need_more';
  }
  return 'text';
}

export function responseIdFromChatId(id: string | undefined | null): string {
  const value = id && id !== '' ? id : 'eco';
  return value.startsWith('resp_') ? value : `resp_${value}`;
}

export function responseStatusFromFinishReason(
  finishReason: string | undefined | null,
): 'completed' | 'incomplete' {
  return finishReason === 'length' ? 'incomplete' : 'completed';
}

export function isOpenAIOseries(model: string): boolean {
  return (
    model.length > 1 &&
    model.startsWith('o') &&
    model.charCodeAt(1) >= 48 &&
    model.charCodeAt(1) <= 57
  );
}

export function supportsReasoningEffort(model: string): boolean {
  if (isOpenAIOseries(model)) {
    return true;
  }
  const lower = model.toLowerCase();
  if (!lower.startsWith('gpt-')) {
    return false;
  }
  const rest = lower.slice('gpt-'.length);
  const first = rest.charAt(0);
  return first >= '5' && first <= '9';
}

export function shortSha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalizeValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}

export function canonicalizeJsonStringIfParseable(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    return value;
  }
  try {
    return canonicalJsonString(JSON.parse(trimmed) as unknown);
  } catch {
    return value;
  }
}

export function canonicalizeToolArgumentsStr(value: string): string {
  if (value.trim() === '') {
    return '{}';
  }
  return canonicalizeJsonStringIfParseable(value);
}

export function flattenNamespaceToolName(namespace: string, name: string): string {
  const fullName = `${namespace}__${name}`;
  if (fullName.length <= CHAT_TOOL_NAME_MAX_LEN) {
    return fullName;
  }
  const hash = shortSha256Hex(fullName);
  const suffix = `__${hash}`;
  const prefixLen = CHAT_TOOL_NAME_MAX_LEN - suffix.length;
  let prefix = '';
  for (const ch of fullName) {
    if (prefix.length + ch.length > prefixLen) {
      break;
    }
    prefix += ch;
  }
  return `${prefix}${suffix}`;
}

export function customToolInputFromChatArguments(argumentsStr: string): string {
  if (argumentsStr.trim() === '') {
    return '';
  }
  try {
    const parsed = JSON.parse(argumentsStr) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const input = (parsed as Record<string, unknown>)[CUSTOM_TOOL_INPUT_FIELD];
      if (typeof input === 'string') {
        return input;
      }
    }
  } catch {
    /* fall through */
  }
  return argumentsStr;
}

export function parseToolArgumentsObject(argumentsStr: string): Record<string, unknown> {
  if (argumentsStr.trim() === '') {
    return {};
  }
  try {
    const parsed = JSON.parse(argumentsStr) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  return { query: argumentsStr };
}

/** Map Chat Completions / MiniMax-style errors to Responses `{ error: { message, type, code, param } }`. */
export function chatErrorToResponseError(
  body: unknown,
  extras?: Record<string, unknown>,
): { error: Record<string, unknown> } {
  if (body === null || body === undefined) {
    return {
      error: {
        message: 'Upstream returned an empty error response',
        type: 'upstream_error',
        code: null,
        param: null,
        ...extras,
      },
    };
  }

  if (typeof body === 'string') {
    return {
      error: {
        message: body,
        type: 'upstream_error',
        code: null,
        param: null,
        ...extras,
      },
    };
  }

  if (typeof body !== 'object') {
    return {
      error: {
        message: String(body),
        type: 'upstream_error',
        code: null,
        param: null,
        ...extras,
      },
    };
  }

  const value = body as Record<string, unknown>;
  const source =
    value.error !== null && typeof value.error === 'object' && !Array.isArray(value.error)
      ? (value.error as Record<string, unknown>)
      : value;

  const baseResp =
    source.base_resp !== null && typeof source.base_resp === 'object'
      ? (source.base_resp as Record<string, unknown>)
      : value.base_resp !== null && typeof value.base_resp === 'object'
        ? (value.base_resp as Record<string, unknown>)
        : undefined;

  let message: string | undefined;
  for (const candidate of [
    source.message,
    source.detail,
    source.status_msg,
    baseResp?.status_msg,
  ]) {
    if (typeof candidate === 'string' && candidate !== '') {
      message = candidate;
      break;
    }
  }
  if (message === undefined && typeof source === 'string') {
    message = source;
  }
  if (message === undefined) {
    try {
      message = JSON.stringify(source);
    } catch {
      message = 'Upstream error';
    }
  }

  const errorType =
    typeof source.type === 'string' && source.type !== '' ? source.type : 'upstream_error';
  const code = source.code ?? baseResp?.status_code ?? null;
  const param = source.param ?? null;

  return {
    error: {
      message,
      type: errorType,
      code,
      param,
      ...extras,
    },
  };
}
