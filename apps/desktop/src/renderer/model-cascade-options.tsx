import type { CommitModelOptionView, CommitModelPricingHint } from "../shared/ipc";
import type {
  ModelCascadeOption,
  ModelCascadeSelection,
} from "./ModelCascadeSelect";
import { CommitModelPricingCompact } from "./CommitModelPricingCompact";
import type { ReactNode } from "react";

export interface CandidateModelSelection {
  providerId: string;
  modelId: string;
  candidateModelId: string;
}

/** Map commit-model options into the unified cascade option shape. */
export function mapCommitModelOptions(options: readonly CommitModelOptionView[]): ModelCascadeOption[] {
  return options.map((option) => ({
    key: option.candidateModelId,
    providerId: option.providerId,
    providerName: option.providerName,
    providerColor: option.providerColor,
    modelId: option.modelId,
    label: option.modelLabel,
  }));
}

/** Map a candidate-model selection (auxiliary/vision) into a cascade selection. */
export function toModelCascadeSelection(
  selection: CandidateModelSelection | undefined,
): ModelCascadeSelection | undefined {
  if (!selection) {
    return undefined;
  }
  return {
    key: selection.candidateModelId,
    providerId: selection.providerId,
    modelId: selection.modelId,
  };
}

/** Map a cascade selection back into a candidate-model selection. */
export function toCandidateModelSelection(
  selection: ModelCascadeSelection,
): CandidateModelSelection {
  return {
    providerId: selection.providerId,
    modelId: selection.modelId,
    candidateModelId: selection.key ?? selection.modelId,
  };
}

/**
 * Build a `renderExtra` callback that shows compact pricing next to each
 * commit-model option (matched by candidate model id).
 */
export function createCommitModelPricingExtra(
  options: readonly CommitModelOptionView[],
): (option: ModelCascadeOption) => ReactNode {
  const hints = new Map<string, CommitModelPricingHint>();
  for (const option of options) {
    const hint = option.hint;
    if (hint) {
      hints.set(option.candidateModelId, hint);
    }
  }
  return (option: ModelCascadeOption): ReactNode => {
    const hint = hints.get(option.key);
    return hint ? <CommitModelPricingCompact hint={hint} /> : null;
  };
}
