export type AcpModelVendor = "anthropic" | "gpt" | "grok" | "google" | "other";

export interface AcpModelOption {
  id: string;
  displayName: string;
  current?: boolean;
  default?: boolean;
}

export const ACP_MODEL_VENDORS: readonly AcpModelVendor[] = ["anthropic", "gpt", "grok", "google", "other"];

export const ACP_MODEL_VENDOR_ICONS: Record<AcpModelVendor, string> = {
  anthropic: "./agent-icons/claude-code.ico",
  gpt: "./agent-icons/codex.ico",
  grok: "./agent-icons/grok.ico",
  google: "./agent-icons/gemini.png",
  other: "./agent-icons/other.svg",
};

function haystack(model: { id: string; displayName?: string }): string {
  return `${model.id} ${model.displayName ?? ""}`.toLowerCase();
}

export function classifyAcpModelVendor(model: { id: string; displayName?: string }): AcpModelVendor {
  const text = haystack(model);
  if (/\bgrok\b/.test(text) || text.includes("xai")) return "grok";
  if (text.includes("gemini") || text.includes("gemma") || text.includes("google")) return "google";
  if (
    text.includes("claude") ||
    text.includes("anthropic") ||
    text.includes("sonnet") ||
    text.includes("opus") ||
    text.includes("haiku")
  ) {
    return "anthropic";
  }
  if (
    text.includes("gpt") ||
    text.includes("openai") ||
    text.includes("chatgpt") ||
    /(^|[^a-z])o[1-9]([.-]|$)/.test(text)
  ) {
    return "gpt";
  }
  return "other";
}

export function groupAcpModelsByVendor<T extends { id: string; displayName?: string }>(
  models: readonly T[],
): Record<AcpModelVendor, T[]> {
  const grouped: Record<AcpModelVendor, T[]> = {
    anthropic: [],
    gpt: [],
    grok: [],
    google: [],
    other: [],
  };
  for (const model of models) {
    grouped[classifyAcpModelVendor(model)].push(model);
  }
  return grouped;
}

export function filterAcpModels<T extends { id: string; displayName?: string }>(
  models: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...models];
  return models.filter((model) => haystack(model).includes(needle));
}

export function resolveAcpModelVendor(
  selectedModelId: string | undefined,
  models: readonly { id: string; displayName?: string }[],
): AcpModelVendor {
  if (selectedModelId) {
    const selected = models.find((model) => model.id === selectedModelId);
    return classifyAcpModelVendor(selected ?? { id: selectedModelId });
  }
  const grouped = groupAcpModelsByVendor(models);
  return ACP_MODEL_VENDORS.find((vendor) => grouped[vendor].length > 0) ?? "anthropic";
}

export function resolveAcpComposerTriggerLabel(
  models: readonly { id: string; displayName?: string; current?: boolean }[],
  selectedModelId: string | undefined,
  defaultLabel: string,
): string {
  const selectedId = selectedModelId?.trim();
  if (selectedId) {
    const match = models.find((model) => model.id === selectedId);
    const displayName = match?.displayName?.trim();
    return displayName || selectedId;
  }
  const current = models.find((model) => model.current);
  const currentName = current?.displayName?.trim();
  return currentName || defaultLabel;
}
