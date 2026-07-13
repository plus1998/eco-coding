import type { ThinkingEffort } from "../shared/ipc";

const THINKING_EFFORT_LABELS: Record<ThinkingEffort, string> = {
  off: "关闭",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最大",
};

export type ComposerModelLabelSize = "small" | "medium";

export interface ComposerModelLabelProps {
  modelId: string;
  displayName?: string | undefined;
  thinkingEffort?: ThinkingEffort | undefined;
  size: ComposerModelLabelSize;
  effortAccent?: boolean | undefined;
}

export function ComposerModelLabel({
  modelId,
  displayName,
  thinkingEffort,
  size,
  effortAccent,
}: ComposerModelLabelProps) {
  const modelName = formatComposerModelName(modelId, displayName);
  const effortLabel = formatComposerThinkingEffortLabel(thinkingEffort);
  return (
    <span className={`composer-model-label is-${size}`} title={`${modelName} ${effortLabel}`}>
      <span className="composer-model-label-name">{modelName}</span>
      <span
        className={effortAccent ? "composer-model-label-effort is-accent" : "composer-model-label-effort"}
      >
        {effortLabel}
      </span>
    </span>
  );
}

export function formatComposerModelName(modelId: string, displayName?: string): string {
  const preferred = displayName?.trim();
  if (preferred) {
    return preferred;
  }
  const normalizedModelId = modelId.trim();
  const leaf = normalizedModelId.includes("/")
    ? (normalizedModelId.split("/").pop() ?? normalizedModelId)
    : normalizedModelId;
  const gptMatch = leaf.match(/^gpt-(\d+(?:\.\d+)*)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/i);
  if (gptMatch) {
    const version = gptMatch[1];
    if (!version) {
      return leaf;
    }
    const suffix = gptMatch[2]
      ?.split("-")
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
      .join(" ");
    return suffix ? `${version} ${suffix}` : version;
  }
  return leaf.length > 24 ? `${leaf.slice(0, 12)}…${leaf.slice(-9)}` : leaf;
}

export function formatComposerThinkingEffortLabel(effort: ThinkingEffort | undefined): string {
  return effort ? THINKING_EFFORT_LABELS[effort] : "默认";
}
