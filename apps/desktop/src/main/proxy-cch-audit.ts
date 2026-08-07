/** Scan / normalize Claude Code billing attestation (`cch=`) in proxy-bound requests. */

import { isAnthropicBillingHeaderText } from "@eco/openai-anthropic-bridge";

const BILLING_HEADER_PREFIX = "x-anthropic-billing-header:";
const CCH_VALUE_PATTERN = /\bcch=([0-9a-f]{4,})\b/gi;
/** Stable upstream placeholder — must not be `cch=00000` (SDK poison sentinel). */
export const STABLE_CCH_PLACEHOLDER = "cch=eco";
const MAX_HITS = 24;
const SNIPPET_MAX_CHARS = 120;

export type ProxyCchHitKind = "billing_header" | "cch_token";

export interface ProxyCchHit {
  path: string;
  kind: ProxyCchHitKind;
  snippet: string;
  cchValue?: string;
}

export interface ProxyCchAudit {
  hitCount: number;
  uniqueCchValues: string[];
  billingHeaderInSystem: boolean;
  hits: ProxyCchHit[];
}

export function isProxyCchAuditEnabled(): boolean {
  const value = process.env.ECO_PROXY_CCH_AUDIT?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/** Default on; set ECO_PROXY_CCH_NORMALIZE=0 to passthrough raw SDK bodies to upstream. */
export function isProxyCchNormalizeEnabled(): boolean {
  const value = process.env.ECO_PROXY_CCH_NORMALIZE?.trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "no";
}

export function normalizeCchInText(text: string): string {
  return text.replace(CCH_VALUE_PATTERN, STABLE_CCH_PLACEHOLDER);
}

export function normalizeAnthropicMessagesBodyForCache(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };

  if (body.system !== undefined) {
    const normalizedSystem = normalizeSystemValue(body.system);
    if (normalizedSystem === undefined) {
      delete out.system;
    } else {
      out.system = normalizedSystem;
    }
  }

  if (Array.isArray(body.messages)) {
    out.messages = body.messages.map((message) => normalizeMessageValue(message));
  }

  return out;
}

/**
 * Product-layer CCH audit (optional) + normalize (default on) for Claude Messages bodies
 * before they leave Bridge for Gateway. Same rules as legacy bridge-upstream.
 */
export function applyProxyCchToAnthropicMessagesBody(
  body: Record<string, unknown>,
  options?: {
    onAudit?: (phase: "sdk" | "upstream", audit: ProxyCchAudit) => void;
  },
): Record<string, unknown> {
  if (options?.onAudit && isProxyCchAuditEnabled()) {
    options.onAudit("sdk", auditAnthropicMessagesBody(body));
  }
  if (!isProxyCchNormalizeEnabled()) {
    return body;
  }
  const normalized = normalizeAnthropicMessagesBodyForCache(body);
  if (options?.onAudit && isProxyCchAuditEnabled()) {
    options.onAudit("upstream", auditAnthropicMessagesBody(normalized));
  }
  return normalized;
}

function normalizeSystemValue(system: unknown): unknown | undefined {
  if (typeof system === "string") {
    if (isAnthropicBillingHeaderText(system.trimStart())) {
      return undefined;
    }
    return normalizeCchInText(system);
  }

  if (!Array.isArray(system)) {
    return system;
  }

  const blocks = system
    .map((block) => normalizeSystemBlock(block))
    .filter((block): block is Record<string, unknown> => block !== undefined);

  return blocks.length > 0 ? blocks : undefined;
}

function normalizeSystemBlock(block: unknown): Record<string, unknown> | undefined {
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    return undefined;
  }

  const record = block as Record<string, unknown>;
  if (typeof record.text !== "string") {
    return { ...record };
  }

  if (isAnthropicBillingHeaderText(record.text.trimStart())) {
    return undefined;
  }

  return { ...record, text: normalizeCchInText(record.text) };
}

function normalizeMessageValue(message: unknown): unknown {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return message;
  }

  const record = message as Record<string, unknown>;
  if (!("content" in record)) {
    return { ...record };
  }

  return {
    ...record,
    content: normalizeContentValue(record.content),
  };
}

function normalizeContentValue(content: unknown): unknown {
  if (typeof content === "string") {
    return normalizeCchInText(content);
  }

  if (!Array.isArray(content)) {
    return content;
  }

  return content.map((block) => normalizeContentBlock(block));
}

function normalizeContentBlock(block: unknown): unknown {
  if (typeof block === "string") {
    return normalizeCchInText(block);
  }

  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    return block;
  }

  const record = block as Record<string, unknown>;
  const out: Record<string, unknown> = { ...record };

  if (typeof record.text === "string") {
    out.text = normalizeCchInText(record.text);
  }

  if (typeof record.content === "string") {
    out.content = normalizeCchInText(record.content);
  } else if (record.content !== undefined) {
    out.content = normalizeContentValue(record.content);
  }

  return out;
}

export function auditAnthropicMessagesBody(body: Record<string, unknown>): ProxyCchAudit {
  const hits: ProxyCchHit[] = [];
  const cchValues = new Set<string>();

  if (body.system !== undefined) {
    scanValue(body.system, "system", hits, cchValues);
  }

  const messages = body.messages;
  if (Array.isArray(messages)) {
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (typeof message === "object" && message !== null && !Array.isArray(message)) {
        scanAnthropicMessage(message as Record<string, unknown>, `messages[${index}]`, hits, cchValues);
      }
    }
  }

  const uniqueCchValues = [...cchValues].sort();
  return {
    hitCount: hits.length,
    uniqueCchValues,
    billingHeaderInSystem: hits.some(
      (hit) => hit.kind === "billing_header" && hit.path.startsWith("system"),
    ),
    hits,
  };
}

function scanAnthropicMessage(
  message: Record<string, unknown>,
  path: string,
  hits: ProxyCchHit[],
  cchValues: Set<string>,
): void {
  if ("content" in message) {
    scanValue(message.content, `${path}.content`, hits, cchValues);
  }
}

function scanValue(
  value: unknown,
  path: string,
  hits: ProxyCchHit[],
  cchValues: Set<string>,
): void {
  if (hits.length >= MAX_HITS) {
    return;
  }

  if (typeof value === "string") {
    scanString(value, path, hits, cchValues);
    return;
  }

  if (!Array.isArray(value)) {
    if (typeof value === "object" && value !== null) {
      scanObject(value as Record<string, unknown>, path, hits, cchValues);
    }
    return;
  }

  for (let index = 0; index < value.length; index += 1) {
    if (hits.length >= MAX_HITS) {
      return;
    }
    const entry = value[index];
    if (typeof entry === "string") {
      scanString(entry, `${path}[${index}]`, hits, cchValues);
      continue;
    }
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      scanContentBlock(entry as Record<string, unknown>, `${path}[${index}]`, hits, cchValues);
    }
  }
}

function scanObject(
  value: Record<string, unknown>,
  path: string,
  hits: ProxyCchHit[],
  cchValues: Set<string>,
): void {
  for (const [key, entry] of Object.entries(value)) {
    if (hits.length >= MAX_HITS) {
      return;
    }
    scanValue(entry, `${path}.${key}`, hits, cchValues);
  }
}

function scanContentBlock(
  block: Record<string, unknown>,
  path: string,
  hits: ProxyCchHit[],
  cchValues: Set<string>,
): void {
  if (typeof block.text === "string") {
    scanString(block.text, `${path}.text`, hits, cchValues);
  }
  if (typeof block.content === "string") {
    scanString(block.content, `${path}.content`, hits, cchValues);
  } else if (block.content !== undefined) {
    scanValue(block.content, `${path}.content`, hits, cchValues);
  }
}

function scanString(
  text: string,
  path: string,
  hits: ProxyCchHit[],
  cchValues: Set<string>,
): void {
  if (text.length === 0 || hits.length >= MAX_HITS) {
    return;
  }

  const trimmed = text.trimStart();
  if (trimmed.toLowerCase().startsWith(BILLING_HEADER_PREFIX)) {
    const cchValue = firstCchValue(text);
    recordHit(
      hits,
      cchValues,
      {
        path,
        kind: "billing_header",
        snippet: snippetFor(text),
        ...(cchValue ? { cchValue } : {}),
      },
      text,
    );
    return;
  }

  CCH_VALUE_PATTERN.lastIndex = 0;
  let match = CCH_VALUE_PATTERN.exec(text);
  while (match !== null) {
    if (hits.length >= MAX_HITS) {
      return;
    }
    const cchValue = match[1]?.toLowerCase();
    recordHit(
      hits,
      cchValues,
      {
        path,
        kind: "cch_token",
        snippet: snippetFor(text, match.index),
        ...(cchValue ? { cchValue } : {}),
      },
      text,
    );
    match = CCH_VALUE_PATTERN.exec(text);
  }
}

function recordHit(
  hits: ProxyCchHit[],
  cchValues: Set<string>,
  hit: ProxyCchHit,
  sourceText: string,
): void {
  collectCchValues(sourceText, cchValues);
  hits.push(hit);
}

function firstCchValue(text: string): string | undefined {
  CCH_VALUE_PATTERN.lastIndex = 0;
  const match = CCH_VALUE_PATTERN.exec(text);
  return match?.[1]?.toLowerCase();
}

function collectCchValues(text: string, cchValues: Set<string>): void {
  CCH_VALUE_PATTERN.lastIndex = 0;
  let match = CCH_VALUE_PATTERN.exec(text);
  while (match !== null) {
    const value = match[1]?.toLowerCase();
    if (value) {
      cchValues.add(value);
    }
    match = CCH_VALUE_PATTERN.exec(text);
  }
}

function snippetFor(text: string, start = 0): string {
  const slice = text.slice(start, start + SNIPPET_MAX_CHARS).replace(/\s+/g, " ").trim();
  if (text.length > start + SNIPPET_MAX_CHARS) {
    return `${slice}…`;
  }
  return slice;
}
