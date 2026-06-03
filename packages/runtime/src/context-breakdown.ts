export type ContextSegmentKey =
  | "systemPrompt"
  | "toolDefinitions"
  | "rules"
  | "skills"
  | "mcp"
  | "subagentDefinitions"
  | "conversation"
  | "unattributed";

export interface ContextBreakdownSegment {
  key: ContextSegmentKey;
  label: string;
  tokens: number;
  color: string;
}

export const CONTEXT_SEGMENT_COLORS: Record<ContextSegmentKey, string> = {
  systemPrompt: "#9ca3af",
  toolDefinitions: "#a78bfa",
  rules: "#2dd4bf",
  skills: "#ca8a04",
  mcp: "#e879f9",
  subagentDefinitions: "#60a5fa",
  conversation: "#ea580c",
  unattributed: "#78716c",
};

export const CONTEXT_SEGMENT_LABELS: Record<ContextSegmentKey, string> = {
  systemPrompt: "系统提示",
  toolDefinitions: "工具定义",
  rules: "规则",
  skills: "技能",
  mcp: "MCP",
  subagentDefinitions: "子代理定义",
  conversation: "会话",
  unattributed: "其他",
};

/** Maps English labels from Claude Code /context output to segment keys. */
const CONTEXT_LABEL_PATTERNS: { key: ContextSegmentKey; patterns: RegExp[] }[] = [
  { key: "systemPrompt", patterns: [/^system\s*prompts?$/i, /^base\s*system\s*prompt$/i, /^系统提示/] },
  {
    key: "toolDefinitions",
    patterns: [/^tool\s*definitions?$/i, /^tools?$/i, /^tool\s*schemas?$/i, /^工具定义/],
  },
  {
    key: "rules",
    patterns: [/^rules?$/i, /^memory(?:\s*files?)?$/i, /^instructions?$/i, /^claude\.md$/i, /^规则/],
  },
  { key: "skills", patterns: [/^skills?(?:\s*(?:descriptions?|list))?$/i, /^技能/] },
  { key: "mcp", patterns: [/^mcp(?:\s*(?:tools?|servers?))?$/i] },
  {
    key: "subagentDefinitions",
    patterns: [/^subagent\s*definitions?$/i, /^subagents?$/i, /^agent\s*definitions?$/i, /^子代理定义/],
  },
  {
    key: "conversation",
    patterns: [
      /^conversation$/i,
      /^messages?$/i,
      /^transcript$/i,
      /^chat\s*history$/i,
      /^session(?:\s*usage)?$/i,
      /^对话/,
      /^会话/,
    ],
  },
  { key: "unattributed", patterns: [/^other(?:\s*usage)?$/i, /^unattributed$/i, /^其他/] },
];

const CONTEXT_TOTAL_LABEL_PATTERNS = [
  /^total(?:\s*tokens?)?$/i,
  /^used$/i,
  /^free$/i,
  /^remaining$/i,
  /^available$/i,
  /^context\s*window$/i,
  /^max(?:imum)?(?:\s*tokens?)?$/i,
];

export interface ContextCommandHeader {
  occupied: number;
  limit: number;
  occupancyPct?: number;
}

/**
 * Parse Claude Code `/context` summary line, e.g.
 * `claude-sonnet-4 · 76k/200k tokens (38%)`
 */
export function parseContextCommandHeader(text: string): ContextCommandHeader | null {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const slashMatch = trimmed.match(
      /([\d.,]+\s*[kKmM]?)\s*\/\s*([\d.,]+\s*[kKmM]?)\s*tokens?\s*(?:\((\d+)%\))?/i,
    );
    if (slashMatch) {
      const occupiedRaw = slashMatch[1];
      const limitRaw = slashMatch[2];
      const pctRaw = slashMatch[3];
      if (!occupiedRaw || !limitRaw) {
        continue;
      }
      const occupied = parseTokenCount(occupiedRaw);
      const limit = parseTokenCount(limitRaw);
      if (occupied <= 0 || limit <= 0) {
        continue;
      }
      const pct =
        pctRaw !== undefined && Number.isFinite(Number.parseInt(pctRaw, 10))
          ? Number.parseInt(pctRaw, 10)
          : undefined;
      return { occupied, limit, ...(pct !== undefined && { occupancyPct: pct }) };
    }
  }
  return null;
}

function parseTokenCount(raw: string): number {
  const normalized = raw.trim().replace(/,/g, "");
  const match = normalized.match(/^([\d.]+)\s*([kKmM])?$/);
  if (!match) {
    const digits = Number.parseInt(normalized, 10);
    return Number.isFinite(digits) ? digits : 0;
  }
  const rawValue = match[1];
  if (!rawValue) {
    return 0;
  }
  const value = Number.parseFloat(rawValue);
  if (!Number.isFinite(value)) {
    return 0;
  }
  const suffix = match[2]?.toLowerCase();
  if (suffix === "k") {
    return Math.round(value * 1000);
  }
  if (suffix === "m") {
    return Math.round(value * 1_000_000);
  }
  return Math.round(value);
}

function resolveSegmentKey(label: string): ContextSegmentKey | null {
  const trimmed = label.trim();
  for (const entry of CONTEXT_LABEL_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(trimmed))) {
      return entry.key;
    }
  }
  return null;
}

function shouldIgnoreUnknownLabel(label: string): boolean {
  const trimmed = label.trim();
  return CONTEXT_TOTAL_LABEL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function segmentFromKey(key: ContextSegmentKey, tokens: number): ContextBreakdownSegment {
  return {
    key,
    label: CONTEXT_SEGMENT_LABELS[key],
    tokens,
    color: CONTEXT_SEGMENT_COLORS[key],
  };
}

function isContextSegmentKey(key: string): key is ContextSegmentKey {
  return key in CONTEXT_SEGMENT_LABELS;
}

/** Re-apply canonical labels/colors and merge duplicate keys (e.g. restored snapshots). */
export function normalizeContextSegments(
  segments: readonly ContextBreakdownSegment[],
): ContextBreakdownSegment[] {
  const merged = new Map<ContextSegmentKey, number>();
  for (const segment of segments) {
    if (segment.tokens <= 0) {
      continue;
    }
    const key = isContextSegmentKey(segment.key) ? segment.key : "unattributed";
    merged.set(key, (merged.get(key) ?? 0) + segment.tokens);
  }
  return [...merged.entries()]
    .map(([key, tokens]) => segmentFromKey(key, tokens))
    .sort((left, right) => right.tokens - left.tokens);
}

/**
 * Parse Claude Code `/context` command text output into breakdown segments.
 */
export function parseContextCommandResult(
  text: string,
  fallbackOccupied?: number,
): ContextBreakdownSegment[] {
  const segments = new Map<ContextSegmentKey, number>();

  const addLabeledSegment = (rawLabel: string, rawTokens: string) => {
    const tokens = parseTokenCount(rawTokens);
    if (tokens <= 0) {
      return;
    }
    const key = resolveSegmentKey(rawLabel);
    if (key) {
      segments.set(key, (segments.get(key) ?? 0) + tokens);
      return;
    }
    if (!shouldIgnoreUnknownLabel(rawLabel)) {
      segments.set("unattributed", (segments.get("unattributed") ?? 0) + tokens);
    }
  };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const pipeMatch = trimmed.match(/^([^|]+)\|\s*([\d.,]+\s*[kKmM]?)\s*$/i);
    if (pipeMatch) {
      const [, label, tokens] = pipeMatch;
      if (label && tokens) {
        addLabeledSegment(label, tokens);
      }
      continue;
    }

    const colonMatch = trimmed.match(/^([^:]+):\s*([\d.,]+\s*[kKmM]?)\s*(?:tokens?)?$/i);
    if (colonMatch) {
      const [, label, tokens] = colonMatch;
      if (label && tokens) {
        addLabeledSegment(label, tokens);
      }
    }
  }

  if (segments.size === 0) {
    if (fallbackOccupied !== undefined && fallbackOccupied > 0) {
      return [segmentFromKey("conversation", fallbackOccupied)];
    }
    return [];
  }

  return [...segments.entries()]
    .map(([key, tokens]) => segmentFromKey(key, tokens))
    .filter((segment) => segment.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
}

export function mergeBreakdownWithOccupancy(
  segments: ContextBreakdownSegment[],
  occupied: number,
): ContextBreakdownSegment[] {
  const normalized = normalizeContextSegments(segments);
  if (normalized.length === 0 && occupied > 0) {
    return [segmentFromKey("conversation", occupied)];
  }
  const sum = normalized.reduce((total, segment) => total + segment.tokens, 0);
  if (sum === 0 && occupied > 0) {
    return [segmentFromKey("conversation", occupied)];
  }
  if (occupied > sum) {
    const gap = occupied - sum;
    const merged = new Map(normalized.map((segment) => [segment.key, segment.tokens]));
    merged.set("unattributed", (merged.get("unattributed") ?? 0) + gap);
    return [...merged.entries()]
      .map(([key, tokens]) => segmentFromKey(key, tokens))
      .sort((left, right) => right.tokens - left.tokens);
  }
  return normalized;
}
