/** Upstream API surface used for chat and connection tests. */
export type UpstreamApiCompat =
  | "anthropic"
  | "openai_responses"
  | "openai_chat_completions";

export const API_COMPAT_THEME: Record<UpstreamApiCompat, { label: string; color: string }> = {
  anthropic: {
    label: "Anthropic",
    color: "#cc785c",
  },
  openai_responses: {
    label: "OpenAI Responses",
    color: "#10a37f",
  },
  openai_chat_completions: {
    label: "OpenAI Chat",
    color: "#0d7ae8",
  },
};

export const UPSTREAM_API_COMPAT_CYCLE: UpstreamApiCompat[] = [
  "anthropic",
  "openai_responses",
  "openai_chat_completions",
];

export function isOpenAICompat(apiCompat: UpstreamApiCompat): boolean {
  return apiCompat === "openai_responses" || apiCompat === "openai_chat_completions";
}

export function toggleUpstreamApiCompat(value: UpstreamApiCompat): UpstreamApiCompat {
  const index = UPSTREAM_API_COMPAT_CYCLE.indexOf(value);
  const next = index < 0 ? 0 : (index + 1) % UPSTREAM_API_COMPAT_CYCLE.length;
  return UPSTREAM_API_COMPAT_CYCLE[next] ?? "anthropic";
}

export const UPSTREAM_API_COMPAT_OPTIONS: Array<{
  value: UpstreamApiCompat;
  label: string;
  hint: string;
}> = [
  {
    value: "anthropic",
    label: "Anthropic Messages",
    hint: "POST …/v1/messages（Anthropic 协议）",
  },
  {
    value: "openai_responses",
    label: "OpenAI Responses",
    hint: "POST …/v1/responses（Responses 枢纽，Codex / 官方 OpenAI 推荐）",
  },
  {
    value: "openai_chat_completions",
    label: "OpenAI Chat Completions",
    hint: "POST …/v1/chat/completions（DeepSeek / Kimi 等兼容上游）",
  },
];

/** Legacy stored value `openai` maps to Responses. */
export function normalizeUpstreamApiCompat(value?: string | null): UpstreamApiCompat {
  if (value === "openai" || value === "openai_responses") {
    return "openai_responses";
  }
  if (value === "openai_chat_completions") {
    return "openai_chat_completions";
  }
  return "anthropic";
}

export function resolveUpstreamApiCompat(
  routeCompat?: UpstreamApiCompat,
  providerCompat?: UpstreamApiCompat,
): UpstreamApiCompat {
  if (routeCompat) {
    return routeCompat;
  }
  if (providerCompat) {
    return providerCompat;
  }
  return "anthropic";
}
