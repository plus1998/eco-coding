import type { Ref } from "react";
import type { ThinkingEffort } from "../shared/ipc";
import { i18n } from "./i18n";

const THINKING_EFFORT_KEYS: Record<ThinkingEffort, string> = {
  off: "settings.models.effort.off",
  low: "settings.models.effort.low",
  medium: "settings.models.effort.medium",
  high: "settings.models.effort.high",
  xhigh: "settings.models.effort.xhigh",
  max: "settings.models.effort.max",
};

export type ComposerModelLabelSize = "small" | "medium";

export interface ComposerModelLabelProps {
  modelId: string;
  displayName?: string | undefined;
  thinkingEffort?: ThinkingEffort | undefined;
  size: ComposerModelLabelSize;
  effortAccent?: boolean | undefined;
  nameRef?: Ref<HTMLSpanElement> | undefined;
}

export function ComposerModelLabel({
  modelId,
  displayName,
  thinkingEffort,
  size,
  effortAccent,
  nameRef,
}: ComposerModelLabelProps) {
  const modelName = formatComposerModelName(modelId, displayName);
  const effortLabel = formatComposerThinkingEffortLabel(thinkingEffort);
  return (
    <span className={`composer-model-label is-${size}`}>
      <span ref={nameRef} className="composer-model-label-name">
        {modelName}
      </span>
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
  return effort ? i18n.t(THINKING_EFFORT_KEYS[effort]) : i18n.t("common.default");
}
