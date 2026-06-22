import type { ModelsDevMapping, RouteCapabilityHint, RouteManualSpec, RoutePricingHint } from "../shared/ipc";
import {
  applyPriceMultiplierToPerMRates,
  normalizeStoredPriceMultiplier,
  resolvePriceMultiplier,
} from "../shared/manual-spec-pricing";

export type ManualTriState = "auto" | "yes" | "no";

export interface ManualSpecFormFields {
  contextTokens: string;
  maxOutputTokens: string;
  supportsImageInput: ManualTriState;
  supportsReasoning: ManualTriState;
  priceMultiplier: string;
  inputPerM: string;
  outputPerM: string;
  cacheReadPerM: string;
  cacheWritePerM: string;
}

export type ManualSpecOverrideField =
  | "contextTokens"
  | "maxOutputTokens"
  | "supportsImageInput"
  | "supportsReasoning"
  | "priceMultiplier"
  | "inputPerM"
  | "outputPerM"
  | "cacheReadPerM"
  | "cacheWritePerM";

export function emptyManualSpecForm(): ManualSpecFormFields {
  return {
    contextTokens: "",
    maxOutputTokens: "",
    supportsImageInput: "auto",
    supportsReasoning: "auto",
    priceMultiplier: "1",
    inputPerM: "",
    outputPerM: "",
    cacheReadPerM: "",
    cacheWritePerM: "",
  };
}

function pricingFieldsFromManual(spec?: RouteManualSpec): Pick<
  ManualSpecFormFields,
  "priceMultiplier" | "inputPerM" | "outputPerM" | "cacheReadPerM" | "cacheWritePerM"
> {
  return {
    priceMultiplier: formatPriceMultiplierFormValue(spec?.priceMultiplier),
    inputPerM: formatManualRateValue(spec?.inputPerM),
    outputPerM: formatManualRateValue(spec?.outputPerM),
    cacheReadPerM: formatManualRateValue(spec?.cacheReadPerM),
    cacheWritePerM: formatManualRateValue(spec?.cacheWritePerM),
  };
}

export function manualSpecToForm(spec?: RouteManualSpec): ManualSpecFormFields {
  return {
    contextTokens: formatManualTokenValue(spec?.contextTokens),
    maxOutputTokens: formatManualTokenValue(spec?.maxOutputTokens),
    supportsImageInput: booleanToTriState(spec?.supportsImageInput),
    supportsReasoning: booleanToTriState(spec?.supportsReasoning),
    ...pricingFieldsFromManual(spec),
  };
}

export interface CandidateResolvedSpecSource {
  manualSpec?: RouteManualSpec;
  resolvedContextTokens?: number;
  resolvedMaxOutputTokens?: number;
  resolvedSupportsImageInput?: boolean;
  resolvedSupportsReasoning?: boolean;
  resolvedInputPerM?: number;
  resolvedOutputPerM?: number;
  resolvedCacheReadPerM?: number;
  resolvedCacheWritePerM?: number;
}

/** 将候选模型解析结果预填到表单，便于参考后手动修改。 */
export function prefillManualSpecFormFromCandidate(
  candidate: CandidateResolvedSpecSource,
): ManualSpecFormFields {
  const hasResolved =
    candidate.resolvedContextTokens !== undefined ||
    candidate.resolvedMaxOutputTokens !== undefined ||
    candidate.resolvedSupportsImageInput !== undefined ||
    candidate.resolvedSupportsReasoning !== undefined ||
    candidate.resolvedInputPerM !== undefined ||
    candidate.resolvedOutputPerM !== undefined ||
    candidate.resolvedCacheReadPerM !== undefined ||
    candidate.resolvedCacheWritePerM !== undefined;

  if (!hasResolved) {
    return manualSpecToForm(candidate.manualSpec);
  }

  return {
    contextTokens: formatManualTokenValue(candidate.resolvedContextTokens),
    maxOutputTokens: formatManualTokenValue(candidate.resolvedMaxOutputTokens),
    supportsImageInput: booleanToTriState(candidate.resolvedSupportsImageInput),
    supportsReasoning: booleanToTriState(candidate.resolvedSupportsReasoning),
    ...pricingFieldsFromManual(candidate.manualSpec),
  };
}

/** 将 models.dev 查询结果预填到表单（含 catalog 正价）。 */
export function prefillManualSpecFormFromHints(
  capability?: RouteCapabilityHint,
  pricing?: RoutePricingHint,
): ManualSpecFormFields {
  const catalogCap = catalogCapabilityHint(capability);
  const catalogPrice = catalogPricingHint(pricing);
  const contextTokens = catalogCap?.catalogContextTokens ?? catalogCap?.contextTokens;
  const maxOutputTokens = catalogCap?.catalogMaxOutputTokens ?? catalogCap?.maxOutputTokens;
  const supportsImageInput =
    catalogCap?.catalogSupportsImageInput ?? catalogCap?.supportsImageInput;
  const supportsReasoning =
    catalogCap?.catalogSupportsReasoning ?? catalogCap?.supportsReasoning;

  return {
    contextTokens: formatManualTokenValue(contextTokens),
    maxOutputTokens: formatManualTokenValue(maxOutputTokens),
    supportsImageInput: booleanToTriState(supportsImageInput),
    supportsReasoning: booleanToTriState(supportsReasoning),
    priceMultiplier: "1",
    inputPerM: formatManualRateValue(catalogPrice?.rates?.inputPerM),
    outputPerM: formatManualRateValue(catalogPrice?.rates?.outputPerM),
    cacheReadPerM: formatManualRateValue(catalogPrice?.rates?.cacheReadPerM),
    cacheWritePerM: formatManualRateValue(catalogPrice?.rates?.cacheWritePerM),
  };
}

export function formToManualSpec(
  form: ManualSpecFormFields,
  options: { strict?: boolean } = {},
): RouteManualSpec | undefined {
  const strict = options.strict ?? false;
  const contextTokens = parseManualTokenInput(form.contextTokens, {
    strict,
    fieldLabel: "手动上下文上限",
  });
  const maxOutputTokens = parseManualTokenInput(form.maxOutputTokens, {
    strict,
    fieldLabel: "手动最大输出",
  });
  const supportsImageInput = triStateToBoolean(form.supportsImageInput);
  const supportsReasoning = triStateToBoolean(form.supportsReasoning);
  const inputPerM = parseManualRateInput(form.inputPerM, { strict, fieldLabel: "输入价格" });
  const outputPerM = parseManualRateInput(form.outputPerM, { strict, fieldLabel: "输出价格" });
  const cacheReadPerM = parseManualRateInput(form.cacheReadPerM, { strict, fieldLabel: "缓存读取价格" });
  const cacheWritePerM = parseManualRateInput(form.cacheWritePerM, { strict, fieldLabel: "缓存写入价格" });
  const priceMultiplier = parsePriceMultiplierInput(form.priceMultiplier, {
    strict,
    fieldLabel: "价格倍率",
  });

  const next: RouteManualSpec = {
    ...(contextTokens !== undefined && { contextTokens }),
    ...(maxOutputTokens !== undefined && { maxOutputTokens }),
    ...(supportsImageInput !== undefined && { supportsImageInput }),
    ...(supportsReasoning !== undefined && { supportsReasoning }),
    ...(priceMultiplier !== undefined && { priceMultiplier }),
    ...(inputPerM !== undefined && { inputPerM }),
    ...(outputPerM !== undefined && { outputPerM }),
    ...(cacheReadPerM !== undefined && { cacheReadPerM }),
    ...(cacheWritePerM !== undefined && { cacheWritePerM }),
  };
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Lenient parse for live capability lookup while the user is editing. */
export function tryFormToManualSpec(form: ManualSpecFormFields): RouteManualSpec | undefined {
  return formToManualSpec(form, { strict: false });
}

export function countManualOverrides(form: ManualSpecFormFields): number {
  let count = 0;
  if (form.contextTokens.trim()) count += 1;
  if (form.maxOutputTokens.trim()) count += 1;
  if (form.supportsImageInput !== "auto") count += 1;
  if (form.supportsReasoning !== "auto") count += 1;
  if (isPriceMultiplierOverride(form.priceMultiplier)) count += 1;
  if (form.inputPerM.trim()) count += 1;
  if (form.outputPerM.trim()) count += 1;
  if (form.cacheReadPerM.trim()) count += 1;
  if (form.cacheWritePerM.trim()) count += 1;
  return count;
}

export function listManualOverrideFields(form: ManualSpecFormFields): Set<ManualSpecOverrideField> {
  const fields = new Set<ManualSpecOverrideField>();
  if (form.contextTokens.trim()) fields.add("contextTokens");
  if (form.maxOutputTokens.trim()) fields.add("maxOutputTokens");
  if (form.supportsImageInput !== "auto") fields.add("supportsImageInput");
  if (form.supportsReasoning !== "auto") fields.add("supportsReasoning");
  if (isPriceMultiplierOverride(form.priceMultiplier)) fields.add("priceMultiplier");
  if (form.inputPerM.trim()) fields.add("inputPerM");
  if (form.outputPerM.trim()) fields.add("outputPerM");
  if (form.cacheReadPerM.trim()) fields.add("cacheReadPerM");
  if (form.cacheWritePerM.trim()) fields.add("cacheWritePerM");
  return fields;
}

export function mergeEffectiveCapabilityHint(
  auto: RouteCapabilityHint | undefined,
  manualSpec: RouteManualSpec | undefined,
): RouteCapabilityHint | undefined {
  if (!auto && !manualSpec) {
    return undefined;
  }
  const contextTokens =
    manualSpec?.contextTokens ?? auto?.contextTokens;
  const maxOutputTokens =
    manualSpec?.maxOutputTokens ?? auto?.maxOutputTokens;
  const supportsImageInput =
    manualSpec?.supportsImageInput ?? auto?.supportsImageInput ?? false;
  const supportsReasoning =
    manualSpec?.supportsReasoning ?? auto?.supportsReasoning ?? false;
  const contextLimitResolved =
    manualSpec?.contextTokens !== undefined ||
    auto?.contextLimitResolved === true;
  const capabilitiesResolved =
    countManualCapabilityOverrides(manualSpec) > 0 || auto?.capabilitiesResolved === true;

  return {
    role: auto?.role ?? ("planner" as const),
    modelId: auto?.modelId ?? "",
    providerName: auto?.providerName ?? "",
    supportsImageInput,
    supportsReasoning,
    capabilitiesResolved,
    contextLimitResolved,
    ...(contextTokens !== undefined && { contextTokens }),
    ...(maxOutputTokens !== undefined && { maxOutputTokens }),
    ...(auto?.modelsDevMapping && { modelsDevMapping: auto.modelsDevMapping }),
    ...(auto?.modelsDevLabel && { modelsDevLabel: auto.modelsDevLabel }),
    ...(auto?.resolvedModelsDevMapping && {
      resolvedModelsDevMapping: auto.resolvedModelsDevMapping,
    }),
    ...(auto?.resolvedModelsDevLabel && { resolvedModelsDevLabel: auto.resolvedModelsDevLabel }),
  };
}

export function mergeEffectivePricingHint(
  auto: RoutePricingHint | undefined,
  manualSpec: RouteManualSpec | undefined,
): RoutePricingHint | undefined {
  if (!auto && !manualSpec) {
    return undefined;
  }
  const autoRates = auto?.rates;
  const inputPerM = manualSpec?.inputPerM ?? autoRates?.inputPerM;
  const outputPerM = manualSpec?.outputPerM ?? autoRates?.outputPerM;
  const cacheReadPerM = manualSpec?.cacheReadPerM ?? autoRates?.cacheReadPerM;
  const cacheWritePerM = manualSpec?.cacheWritePerM ?? autoRates?.cacheWritePerM;
  const baseRates =
    inputPerM !== undefined && outputPerM !== undefined
      ? {
          inputPerM,
          outputPerM,
          ...(cacheReadPerM !== undefined && { cacheReadPerM }),
          ...(cacheWritePerM !== undefined && { cacheWritePerM }),
        }
      : undefined;
  const rates = applyPriceMultiplierToPerMRates(baseRates, resolvePriceMultiplier(manualSpec));
  const hasRates =
    rates?.inputPerM !== undefined &&
    rates.outputPerM !== undefined &&
    rates.inputPerM > 0 &&
    rates.outputPerM > 0;
  const pricingResolved =
    hasManualPricingOverride(manualSpec) || auto?.pricingResolved === true;

  if (!hasRates && !auto) {
    return undefined;
  }

  return {
    role: auto?.role ?? ("planner" as const),
    modelId: auto?.modelId ?? "",
    providerName: auto?.providerName ?? "",
    ...(hasRates && {
      rates,
    }),
    pricingResolved,
    ...(auto?.pricingLabel && { pricingLabel: auto.pricingLabel }),
  };
}

export function formatManualTokenValue(value?: number): string {
  return value !== undefined && value > 0 ? String(value) : "";
}

export function formatManualRateValue(value?: number): string {
  return value !== undefined && value >= 0 ? String(value) : "";
}

export function formatPriceMultiplierFormValue(value?: number): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return "1";
  }
  return String(value);
}

export function parsePriceMultiplierFormValue(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) {
    return 1;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}

export function formatTokenCountHint(value?: number): string | undefined {
  if (value === undefined || value <= 0) {
    return undefined;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1000)}K`;
  }
  return String(value);
}

export function formatCatalogMappingLabel(
  capability?: RouteCapabilityHint,
  pricing?: RoutePricingHint,
  mapping?: ModelsDevMapping,
): string | undefined {
  return (
    capability?.resolvedModelsDevLabel ??
    capability?.modelsDevLabel ??
    pricing?.pricingLabel ??
    (mapping ? `${mapping.providerKey}/${mapping.modelId}` : undefined)
  );
}

export function catalogCapabilityHint(
  hint?: RouteCapabilityHint,
): RouteCapabilityHint | undefined {
  if (!hint) {
    return undefined;
  }
  return {
    ...hint,
    supportsImageInput: hint.catalogSupportsImageInput ?? hint.supportsImageInput,
    supportsReasoning: hint.catalogSupportsReasoning ?? hint.supportsReasoning,
    ...(hint.catalogContextTokens !== undefined
      ? { contextTokens: hint.catalogContextTokens }
      : hint.contextTokens !== undefined && { contextTokens: hint.contextTokens }),
    ...(hint.catalogMaxOutputTokens !== undefined
      ? { maxOutputTokens: hint.catalogMaxOutputTokens }
      : hint.maxOutputTokens !== undefined && { maxOutputTokens: hint.maxOutputTokens }),
  };
}

export function catalogPricingHint(hint?: RoutePricingHint): RoutePricingHint | undefined {
  if (!hint) {
    return undefined;
  }
  const rates = hint.catalogRates ?? hint.rates;
  if (!rates) {
    return undefined;
  }
  return {
    ...hint,
    rates,
  };
}

function parseManualTokenInput(
  value: string,
  options: { strict: boolean; fieldLabel: string },
): number | undefined {
  const trimmed = value.trim().replace(/[_,\s]/g, "");
  if (!trimmed) {
    return undefined;
  }
  if (!/^\d+$/.test(trimmed)) {
    if (options.strict) {
      throw new Error(`${options.fieldLabel}必须是正整数。`);
    }
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    if (options.strict) {
      throw new Error(`${options.fieldLabel}必须是正整数。`);
    }
    return undefined;
  }
  return parsed;
}

function parseManualRateInput(
  value: string,
  options: { strict: boolean; fieldLabel: string },
): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    if (options.strict) {
      throw new Error(`${options.fieldLabel}必须是正数。`);
    }
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    if (options.strict) {
      throw new Error(`${options.fieldLabel}必须是正数。`);
    }
    return undefined;
  }
  return parsed;
}

function booleanToTriState(value: boolean | undefined): ManualTriState {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "auto";
}

function triStateToBoolean(value: ManualTriState): boolean | undefined {
  if (value === "yes") return true;
  if (value === "no") return false;
  return undefined;
}

function countManualCapabilityOverrides(spec?: RouteManualSpec): number {
  if (!spec) return 0;
  let count = 0;
  if (spec.contextTokens !== undefined) count += 1;
  if (spec.maxOutputTokens !== undefined) count += 1;
  if (spec.supportsImageInput !== undefined) count += 1;
  if (spec.supportsReasoning !== undefined) count += 1;
  return count;
}

function hasManualPricingOverride(spec?: RouteManualSpec): boolean {
  if (!spec) return false;
  return (
    spec.inputPerM !== undefined ||
    spec.outputPerM !== undefined ||
    spec.cacheReadPerM !== undefined ||
    spec.cacheWritePerM !== undefined ||
    (spec.priceMultiplier !== undefined && spec.priceMultiplier !== 1)
  );
}

function isPriceMultiplierOverride(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "1") {
    return false;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0;
}

function parsePriceMultiplierInput(
  value: string,
  options: { strict: boolean; fieldLabel: string },
): number | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "1") {
    return undefined;
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    if (options.strict) {
      throw new Error(`${options.fieldLabel}必须是正数。`);
    }
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    if (options.strict) {
      throw new Error(`${options.fieldLabel}必须是正数。`);
    }
    return undefined;
  }
  return normalizeStoredPriceMultiplier(parsed);
}
