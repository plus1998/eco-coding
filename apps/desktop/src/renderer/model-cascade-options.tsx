import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import {
  ACP_MODEL_VENDOR_ICONS,
  type AcpModelOption,
  type AcpModelVendor,
  classifyAcpModelVendor,
} from "../shared/acp-model-vendor";
import type { I18nKey } from "../shared/i18n-catalogs";
import type { CommitModelOptionView, CommitModelPricingHint } from "../shared/ipc";
import { CommitModelPricingCompact } from "./CommitModelPricingCompact";
import type { ModelCascadeOption, ModelCascadeSelection } from "./ModelCascadeSelect";

const ACP_VENDOR_LABEL_KEYS: Record<AcpModelVendor, I18nKey> = {
  anthropic: "settings.acpModel.vendor.anthropic",
  gpt: "settings.acpModel.vendor.gpt",
  grok: "settings.acpModel.vendor.grok",
  google: "settings.acpModel.vendor.google",
  other: "settings.acpModel.vendor.other",
};

export function resolveAcpVendorNames(t: TFunction): Record<AcpModelVendor, string> {
  const names = {} as Record<AcpModelVendor, string>;
  for (const vendor of Object.keys(ACP_VENDOR_LABEL_KEYS) as AcpModelVendor[]) {
    names[vendor] = t(ACP_VENDOR_LABEL_KEYS[vendor]);
  }
  return names;
}

/**
 * Map Cursor ACP model options into cascade options grouped by model vendor
 * (anthropic / gpt / grok / google / other) so the unified selector keeps
 * the provider → model hierarchy instead of a flat list.
 */
export function mapAcpModelOptions(
  models: readonly AcpModelOption[],
  vendorNames: Record<AcpModelVendor, string>,
): ModelCascadeOption[] {
  return models.map((model) => {
    const vendor = classifyAcpModelVendor(model);
    return {
      key: model.id,
      providerId: vendor,
      providerName: vendorNames[vendor],
      providerIcon: ACP_MODEL_VENDOR_ICONS[vendor],
      modelId: model.id,
      label: model.displayName,
      description: model.id,
    };
  });
}

/**
 * `renderExtra` for Cursor ACP options: marks the model that is currently
 * active in Cursor with a localized badge.
 */
export function createAcpCurrentExtra(
  models: readonly AcpModelOption[],
  currentLabel: string,
): (option: ModelCascadeOption) => ReactNode {
  const currentIds = new Set(models.filter((model) => model.current).map((model) => model.id));
  return (option: ModelCascadeOption): ReactNode => {
    if (!currentIds.has(option.modelId)) {
      return null;
    }
    return <span className="model-cascade-model-extra">{currentLabel}</span>;
  };
}

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
export function toCandidateModelSelection(selection: ModelCascadeSelection): CandidateModelSelection {
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
