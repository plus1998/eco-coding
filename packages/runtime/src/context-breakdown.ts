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
  conversation: "对话",
  unattributed: "其他占用",
};

/** Maps English labels from Claude Code /context output to segment keys. */
const CONTEXT_LABEL_PATTERNS: { key: ContextSegmentKey; patterns: RegExp[] }[] = [
  { key: "systemPrompt", patterns: [/^system\s*prompt$/i, /^系统提示/] },
  { key: "toolDefinitions", patterns: [/^tool\s*definitions?$/i, /^工具定义/] },
  { key: "rules", patterns: [/^rules?$/i, /^规则/] },
  { key: "skills", patterns: [/^skills?$/i, /^技能/] },
  { key: "mcp", patterns: [/^mcp$/i] },
  { key: "subagentDefinitions", patterns: [/^subagent\s*definitions?$/i, /^子代理定义/] },
  { key: "conversation", patterns: [/^conversation$/i, /^对话/] },
];

function parseTokenCount(raw: string): number {
  const normalized = raw.trim().replace(/,/g, "");
  const match = normalized.match(/^([\d.]+)\s*([kKmM])?$/);
  if (!match) {
    const digits = Number.parseInt(normalized, 10);
    return Number.isFinite(digits) ? digits : 0;
  }
  const value = Number.parseFloat(match[1]!);
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

function segmentFromKey(key: ContextSegmentKey, tokens: number): ContextBreakdownSegment {
  return {
    key,
    label: CONTEXT_SEGMENT_LABELS[key],
    tokens,
    color: CONTEXT_SEGMENT_COLORS[key],
  };
}

/**
 * Parse Claude Code `/context` command text output into breakdown segments.
 */
export function parseContextCommandResult(text: string, fallbackOccupied?: number): ContextBreakdownSegment[] {
  const segments = new Map<ContextSegmentKey, number>();

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const pipeMatch = trimmed.match(/^([^|]+)\|\s*([\d.,]+\s*[kKmM]?)\s*$/i);
    if (pipeMatch) {
      const key = resolveSegmentKey(pipeMatch[1]!);
      if (key) {
        segments.set(key, parseTokenCount(pipeMatch[2]!));
      }
      continue;
    }

    const colonMatch = trimmed.match(/^([^:]+):\s*([\d.,]+\s*[kKmM]?)\s*(?:tokens?)?$/i);
    if (colonMatch) {
      const key = resolveSegmentKey(colonMatch[1]!);
      if (key) {
        segments.set(key, parseTokenCount(colonMatch[2]!));
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
  if (segments.length === 0 && occupied > 0) {
    return [segmentFromKey("conversation", occupied)];
  }
  const sum = segments.reduce((total, segment) => total + segment.tokens, 0);
  if (sum === 0 && occupied > 0) {
    return [segmentFromKey("conversation", occupied)];
  }
  if (occupied > sum) {
    return [...segments, segmentFromKey("unattributed", occupied - sum)];
  }
  return segments;
}
