import type { CommitModelPricingHint } from "./ipc";
import {
  commitModelPriceScore,
  type CommitMessageCandidateModel,
} from "./resolve-commit-message-route";

export interface CommitModelOption {
  id: string;
  candidateModelId: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelLabel: string;
  providerColor: string;
  hint?: CommitModelPricingHint;
}

const PROVIDER_ACCENT: Record<string, string> = {
  anthropic: "#D97757",
  openai: "#10A37F",
  google: "#4285F4",
  gemini: "#4285F4",
  deepseek: "#4D6BFF",
  moonshot: "#6366F1",
  qwen: "#7C3AED",
  alibaba: "#FF6A00",
  zhipu: "#2563EB",
  glm: "#2563EB",
  meta: "#0866FF",
  mistral: "#F97316",
  groq: "#F43F5E",
};

function pricingSignature(rates?: CommitModelPricingHint["rates"]): string {
  if (!rates) {
    return "unresolved";
  }
  return [
    rates.inputPerM,
    rates.outputPerM,
    rates.cacheReadPerM ?? "",
    rates.cacheWritePerM ?? "",
  ].join(":");
}

export function commitModelDedupeKey(
  providerName: string,
  modelId: string,
  hint?: CommitModelPricingHint,
): string {
  return `${providerName.trim().toLowerCase()}::${modelId.trim()}::${pricingSignature(hint?.rates)}`;
}

export function formatCommitModelDisplayName(modelId: string, displayName?: string): string {
  const preferred = displayName?.trim() || modelId.trim();
  if (!preferred) {
    return "未配置模型";
  }
  const short = preferred.includes("/") ? (preferred.split("/").pop() ?? preferred) : preferred;
  if (short.length <= 28) {
    return short;
  }
  return `${short.slice(0, 12)}…${short.slice(-12)}`;
}

export function resolveProviderAccentColor(providerName: string): string {
  const normalized = providerName.trim().toLowerCase();
  if (!normalized) {
    return "var(--popover-muted)";
  }
  for (const [key, color] of Object.entries(PROVIDER_ACCENT)) {
    if (normalized.includes(key)) {
      return color;
    }
  }
  let hash = 0;
  for (const char of normalized) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 58% 52%)`;
}

export function buildCommitModelOptions(
  candidates: readonly CommitMessageCandidateModel[],
  hints: readonly CommitModelPricingHint[],
): CommitModelOption[] {
  const hintById = new Map(hints.map((hint) => [hint.candidateModelId, hint]));
  const options = candidates.map((candidate) => {
    const hint = hintById.get(candidate.candidateModelId);
    const providerName = hint?.providerName?.trim() || candidate.providerName;
    const modelId = hint?.modelId?.trim() || candidate.modelId;
    const id = commitModelDedupeKey(providerName, modelId, hint);
    return {
      id,
      candidateModelId: candidate.candidateModelId,
      providerId: candidate.providerId,
      providerName,
      modelId,
      modelLabel: formatCommitModelDisplayName(modelId, candidate.displayName),
      providerColor: resolveProviderAccentColor(providerName),
      ...(hint && { hint }),
    };
  });

  return options.sort(
    (left, right) => commitModelPriceScore(left.hint) - commitModelPriceScore(right.hint),
  );
}

export function findCommitModelOptionForCandidateId(
  options: readonly CommitModelOption[],
  candidateModelId: string | undefined,
): CommitModelOption | undefined {
  if (!candidateModelId) {
    return undefined;
  }
  return options.find((option) => option.candidateModelId === candidateModelId);
}

export function resolveInitialCommitModelOption(
  options: readonly CommitModelOption[],
  savedCandidateModelId: string | "auto" | undefined,
  defaultCandidateModelId: string | undefined,
): CommitModelOption | undefined {
  if (savedCandidateModelId && savedCandidateModelId !== "auto") {
    const saved = findCommitModelOptionForCandidateId(options, savedCandidateModelId);
    if (saved) {
      return saved;
    }
  }
  return findCommitModelOptionForCandidateId(options, defaultCandidateModelId);
}
