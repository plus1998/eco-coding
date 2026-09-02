import type { ThreadRunProjectionTimelineItem } from "./ipc";
import type { PromptCacheConfigDriftKind } from "./prompt-cache-config";
import {
  formatPromptCacheConfigDriftMessage as formatPromptCacheConfigDriftMessageFromConfig,
  type PromptCacheOrchestrationLabel,
} from "./prompt-cache-config";

export type PromptCacheTimelineStepKind = "config_drift" | "invalidated" | "hit_dropped";

export interface PromptCacheTimelineStep {
  kind: PromptCacheTimelineStepKind;
  at: string;
  label: string;
  episodeId?: string;
}

export const PROMPT_CACHE_EPISODE_METADATA_KEY = "promptCacheEpisodeId";

export const PROMPT_CACHE_TIMELINE_EVENT_TYPES = [
  "context.cache_config_drift",
  "context.cache_invalidated",
  "billing.cache_hit_dropped",
] as const;

export type PromptCacheTimelineEventType = (typeof PROMPT_CACHE_TIMELINE_EVENT_TYPES)[number];

export function isPromptCacheTimelineEventType(eventType: string): eventType is PromptCacheTimelineEventType {
  return (PROMPT_CACHE_TIMELINE_EVENT_TYPES as readonly string[]).includes(eventType);
}

export function readPromptCacheEpisodeId(metadata: Record<string, unknown> | undefined): string | undefined {
  const direct = metadata?.[PROMPT_CACHE_EPISODE_METADATA_KEY];
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  const promptCache = metadata?.promptCache;
  if (promptCache && typeof promptCache === "object" && !Array.isArray(promptCache)) {
    const nested = (promptCache as Record<string, unknown>).episodeId;
    if (typeof nested === "string" && nested.trim()) {
      return nested.trim();
    }
  }
  return undefined;
}

export function promptCacheTimelineStepFromItem(
  item: ThreadRunProjectionTimelineItem,
): PromptCacheTimelineStep | undefined {
  const text = item.text.trim();
  const episodeId = readPromptCacheEpisodeId(item.metadata);
  if (item.eventType === "context.cache_config_drift") {
    return {
      kind: "config_drift",
      at: item.at,
      label: text || "Composer 配置已变更",
      ...(episodeId && { episodeId }),
    };
  }
  if (item.eventType === "context.cache_invalidated") {
    return {
      kind: "invalidated",
      at: item.at,
      label: text || "本会话 prompt cache 已失效",
      ...(episodeId && { episodeId }),
    };
  }
  if (item.eventType === "billing.cache_hit_dropped") {
    return {
      kind: "hit_dropped",
      at: item.at,
      label: text || "Prompt cache 命中率大幅下降",
      ...(episodeId && { episodeId }),
    };
  }
  return undefined;
}

export function buildPromptCacheTimelineNarrative(steps: readonly PromptCacheTimelineStep[]): string {
  if (steps.length === 0) {
    return "Prompt cache 状态变化";
  }
  const parts = steps.map((step) => shortenPromptCacheStepLabel(step));
  return parts.join(" → ");
}

function shortenPromptCacheStepLabel(step: PromptCacheTimelineStep): string {
  const text = step.label.trim();
  if (step.kind === "config_drift") {
    const switchMatch = text.match(/^已经变更为\s+(.+?)（.+?）$/u);
    if (switchMatch?.[1]) {
      return `Composer 变更 ${switchMatch[1].trim()}`;
    }
    const legacyMatch = text.match(/^(.+?)已变更/u);
    if (legacyMatch?.[1]) {
      return `Composer 变更 ${legacyMatch[1].trim()}`;
    }
    return text || "Composer 配置已变更";
  }
  if (step.kind === "invalidated") {
    const switchMatch = text.match(/^已经变更为\s+(.+?)（.+?），本会话 prompt cache 已失效/u);
    if (switchMatch?.[1]) {
      return `发消息后 cache 失效（${switchMatch[1].trim()}）`;
    }
    if (/已变更，本会话 prompt cache 已失效/u.test(text)) {
      const prefix = text.replace(/已变更，本会话 prompt cache 已失效.*$/u, "").trim();
      return prefix ? `发消息后 cache 失效（${prefix}）` : "发消息后 cache 失效";
    }
    return text || "发消息后 cache 失效";
  }
  if (step.kind === "hit_dropped") {
    const match = text.match(/命中率从\s*(\d+)%\s*降至\s*(\d+)%/u);
    if (match) {
      return `命中率 ${match[1]}% → ${match[2]}%`;
    }
    return text || "命中率骤降";
  }
  return text;
}

export function readPromptCacheTimelineMetadata(
  metadata: Record<string, unknown> | undefined,
): { narrative: string; steps: PromptCacheTimelineStep[] } | undefined {
  const raw = metadata?.promptCacheTimeline;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const narrative = typeof record.narrative === "string" ? record.narrative.trim() : "";
  const steps = Array.isArray(record.steps)
    ? record.steps
        .map((entry) => parsePromptCacheTimelineStep(entry))
        .filter((entry): entry is PromptCacheTimelineStep => Boolean(entry))
    : [];
  if (!narrative && steps.length === 0) {
    return undefined;
  }
  return {
    narrative: narrative || buildPromptCacheTimelineNarrative(steps),
    steps,
  };
}

function parsePromptCacheTimelineStep(value: unknown): PromptCacheTimelineStep | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  const at = typeof record.at === "string" ? record.at : "";
  const label = typeof record.label === "string" ? record.label.trim() : "";
  if (kind !== "config_drift" && kind !== "invalidated" && kind !== "hit_dropped") {
    return undefined;
  }
  if (!at || !label) {
    return undefined;
  }
  const episodeId =
    typeof record.episodeId === "string" && record.episodeId.trim() ? record.episodeId.trim() : undefined;
  return {
    kind,
    at,
    label,
    ...(episodeId && { episodeId }),
  };
}

export function collapsePromptCacheTimelineItems(
  items: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem[] {
  const output: ThreadRunProjectionTimelineItem[] = [];
  let buffer: ThreadRunProjectionTimelineItem[] = [];

  const flush = () => {
    if (buffer.length === 0) {
      return;
    }
    if (buffer.length === 1) {
      output.push(buffer[0]!);
    } else {
      output.push(buildSyntheticPromptCacheTimelineItem(buffer));
    }
    buffer = [];
  };

  for (const item of items) {
    if (isPromptCacheTimelineEventType(item.eventType)) {
      buffer.push(item);
      continue;
    }
    flush();
    output.push(item);
  }
  flush();
  return output;
}

function buildSyntheticPromptCacheTimelineItem(
  items: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem {
  const steps = items
    .map((item) => promptCacheTimelineStepFromItem(item))
    .filter((step): step is PromptCacheTimelineStep => Boolean(step));
  const narrative = buildPromptCacheTimelineNarrative(steps);
  const last = items[items.length - 1]!;
  const episodeId = steps.find((step) => step.episodeId)?.episodeId;
  return {
    ...last,
    id: `prompt-cache-timeline:${items.map((item) => item.id).join(":")}`,
    eventType: "context.cache_invalidated",
    text: narrative,
    metadata: {
      ...(last.metadata ?? {}),
      promptCacheTimeline: {
        narrative,
        steps,
        ...(episodeId && { episodeId }),
      },
      ...(episodeId && { [PROMPT_CACHE_EPISODE_METADATA_KEY]: episodeId }),
    },
  };
}

export function formatPromptCacheConfigDriftMessage(
  kinds: readonly PromptCacheConfigDriftKind[],
  options?: { orchestrationLabel?: PromptCacheOrchestrationLabel },
): string {
  return formatPromptCacheConfigDriftMessageFromConfig(kinds, options);
}
