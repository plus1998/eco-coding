import { formatRatePerMillion } from "@eco/runtime";
import {
  ArrowDown,
  ArrowUp,
  Brain,
  HardDrive,
  Image,
  Layers,
  Maximize2,
  Save,
} from "lucide-react";
import type { CandidateModelView, RouteCapabilityHint, RoutePricingHint } from "../shared/ipc";
import type { ManualSpecOverrideField } from "./agent-profile-manual-spec-form";
import { listManualOverrideFields, manualSpecToForm } from "./agent-profile-manual-spec-form";

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1000)}K`;
  }
  return String(value);
}

function chipClass(
  base: string,
  field: ManualSpecOverrideField | undefined,
  overrides: Set<ManualSpecOverrideField>,
): string {
  if (field && overrides.has(field)) {
    return `${base} model-spec-chip-manual`;
  }
  return base;
}

export function formatCandidateModelsDevLabel(candidate: CandidateModelView): string | undefined {
  if (candidate.modelsDevLabel) {
    return candidate.modelsDevLabel;
  }
  if (candidate.modelsDevMapping) {
    return `${candidate.modelsDevMapping.providerKey}/${candidate.modelsDevMapping.modelId}`;
  }
  return undefined;
}

export function candidateCapabilityHint(candidate: CandidateModelView | undefined): RouteCapabilityHint | undefined {
  if (!candidate) {
    return undefined;
  }
  const hasCapability =
    candidate.resolvedContextTokens !== undefined ||
    candidate.resolvedMaxOutputTokens !== undefined ||
    candidate.resolvedSupportsImageInput !== undefined ||
    candidate.resolvedSupportsReasoning !== undefined;
  if (!hasCapability) {
    return undefined;
  }
  return {
    role: "planner",
    providerName: "",
    modelId: candidate.modelId,
    supportsImageInput: candidate.resolvedSupportsImageInput ?? false,
    supportsReasoning: candidate.resolvedSupportsReasoning ?? false,
    capabilitiesResolved:
      candidate.resolvedSupportsImageInput !== undefined || candidate.resolvedSupportsReasoning !== undefined,
    contextLimitResolved: candidate.resolvedContextTokens !== undefined,
    ...(candidate.resolvedContextTokens !== undefined && {
      contextTokens: candidate.resolvedContextTokens,
      catalogContextTokens: candidate.resolvedContextTokens,
    }),
    ...(candidate.resolvedMaxOutputTokens !== undefined && {
      maxOutputTokens: candidate.resolvedMaxOutputTokens,
      catalogMaxOutputTokens: candidate.resolvedMaxOutputTokens,
    }),
    ...(candidate.resolvedSupportsImageInput !== undefined && {
      catalogSupportsImageInput: candidate.resolvedSupportsImageInput,
    }),
    ...(candidate.resolvedSupportsReasoning !== undefined && {
      catalogSupportsReasoning: candidate.resolvedSupportsReasoning,
    }),
    ...(candidate.modelsDevMapping && {
      modelsDevMapping: candidate.modelsDevMapping,
      resolvedModelsDevMapping: candidate.modelsDevMapping,
    }),
    ...(candidate.modelsDevLabel && {
      modelsDevLabel: candidate.modelsDevLabel,
      resolvedModelsDevLabel: candidate.modelsDevLabel,
    }),
  };
}

export function candidatePricingHint(candidate: CandidateModelView | undefined): RoutePricingHint | undefined {
  if (!candidate || candidate.resolvedInputPerM === undefined || candidate.resolvedOutputPerM === undefined) {
    return undefined;
  }
  const rates = {
    inputPerM: candidate.resolvedInputPerM,
    outputPerM: candidate.resolvedOutputPerM,
    ...(candidate.resolvedCacheReadPerM !== undefined && {
      cacheReadPerM: candidate.resolvedCacheReadPerM,
    }),
    ...(candidate.resolvedCacheWritePerM !== undefined && {
      cacheWritePerM: candidate.resolvedCacheWritePerM,
    }),
  };
  return {
    role: "planner",
    providerName: "",
    modelId: candidate.modelId,
    rates,
    catalogRates: rates,
    pricingResolved: true,
    ...(candidate.modelsDevLabel && { pricingLabel: candidate.modelsDevLabel }),
  };
}

export function candidateOverrideFields(
  candidate: CandidateModelView | undefined,
): Set<ManualSpecOverrideField> | undefined {
  if (!candidate?.manualSpec) {
    return undefined;
  }
  return listManualOverrideFields(manualSpecToForm(candidate.manualSpec));
}

export function ModelSpecSummary({
  capability,
  pricing,
  overriddenFields,
  compact = false,
}: {
  capability?: RouteCapabilityHint;
  pricing?: RoutePricingHint;
  overriddenFields?: Set<ManualSpecOverrideField>;
  compact?: boolean;
}) {
  if (!capability && !pricing) {
    return null;
  }
  const cap = capability;
  const overrides = overriddenFields ?? new Set<ManualSpecOverrideField>();
  const hasContext = cap?.contextLimitResolved && cap.contextTokens !== undefined && cap.contextTokens > 0;
  const hasOutput = cap?.maxOutputTokens !== undefined && cap.maxOutputTokens > 0;
  const hasImage = cap?.supportsImageInput;
  const hasReasoning = cap?.supportsReasoning;
  const rates = pricing?.rates;
  const hasPricing = rates && rates.inputPerM > 0 && rates.outputPerM > 0;
  const hasCache = rates && (rates.cacheReadPerM !== undefined || rates.cacheWritePerM !== undefined);

  if (!hasContext && !hasImage && !hasPricing && !hasOutput && !hasReasoning) {
    return null;
  }

  return (
    <div className={`model-spec-summary${compact ? " model-spec-summary-compact" : ""}`}>
      {hasContext ? (
        <span
          className={chipClass("model-spec-chip model-spec-chip-capability", "contextTokens", overrides)}
          title="上下文窗口"
        >
          <Layers size={13} strokeWidth={2} />
          <span className="model-spec-chip-value">{formatTokenCount(cap!.contextTokens!)}</span>
          {!compact ? <span className="model-spec-chip-caption">上下文</span> : null}
          {overrides.has("contextTokens") ? <span className="model-spec-chip-badge">手动</span> : null}
        </span>
      ) : null}
      {hasOutput ? (
        <span
          className={chipClass("model-spec-chip model-spec-chip-capability", "maxOutputTokens", overrides)}
          title="最大输出"
        >
          <Maximize2 size={13} strokeWidth={2} />
          <span className="model-spec-chip-value">{formatTokenCount(cap!.maxOutputTokens!)}</span>
          {!compact ? <span className="model-spec-chip-caption">输出</span> : null}
          {overrides.has("maxOutputTokens") ? <span className="model-spec-chip-badge">手动</span> : null}
        </span>
      ) : null}
      {hasImage ? (
        <span
          className={chipClass("model-spec-chip model-spec-chip-capability", "supportsImageInput", overrides)}
          title="支持图像输入"
        >
          <Image size={13} strokeWidth={2} />
          {!compact ? <span className="model-spec-chip-caption">多模态</span> : null}
          {overrides.has("supportsImageInput") ? <span className="model-spec-chip-badge">手动</span> : null}
        </span>
      ) : null}
      {hasReasoning ? (
        <span
          className={chipClass("model-spec-chip model-spec-chip-capability", "supportsReasoning", overrides)}
          title="支持推理"
        >
          <Brain size={13} strokeWidth={2} />
          {!compact ? <span className="model-spec-chip-caption">推理</span> : null}
          {overrides.has("supportsReasoning") ? <span className="model-spec-chip-badge">手动</span> : null}
        </span>
      ) : null}
      {hasPricing ? (
        <>
          <span
            className={chipClass("model-spec-chip model-spec-chip-price model-spec-chip-price-in", "inputPerM", overrides)}
            title="输入价格 /M tokens"
          >
            <ArrowUp size={13} strokeWidth={2} />
            <span className="model-spec-chip-value">{formatRatePerMillion(rates!.inputPerM)}</span>
            {overrides.has("inputPerM") ? <span className="model-spec-chip-badge">手动</span> : null}
          </span>
          <span
            className={chipClass(
              "model-spec-chip model-spec-chip-price model-spec-chip-price-out",
              "outputPerM",
              overrides,
            )}
            title="输出价格 /M tokens"
          >
            <ArrowDown size={13} strokeWidth={2} />
            <span className="model-spec-chip-value">{formatRatePerMillion(rates!.outputPerM)}</span>
            {overrides.has("outputPerM") ? <span className="model-spec-chip-badge">手动</span> : null}
          </span>
        </>
      ) : null}
      {hasCache
        ? [
            rates?.cacheReadPerM !== undefined ? (
              <span
                key="cache-read"
                className={chipClass(
                  "model-spec-chip model-spec-chip-price model-spec-chip-price-cache",
                  "cacheReadPerM",
                  overrides,
                )}
                title="缓存读取价格 /M tokens"
              >
                <HardDrive size={13} strokeWidth={2} />
                <span className="model-spec-chip-value">{formatRatePerMillion(rates!.cacheReadPerM!)}</span>
                {overrides.has("cacheReadPerM") ? <span className="model-spec-chip-badge">手动</span> : null}
              </span>
            ) : null,
            rates?.cacheWritePerM !== undefined ? (
              <span
                key="cache-write"
                className={chipClass(
                  "model-spec-chip model-spec-chip-price model-spec-chip-price-cache",
                  "cacheWritePerM",
                  overrides,
                )}
                title="缓存写入价格 /M tokens"
              >
                <Save size={13} strokeWidth={2} />
                <span className="model-spec-chip-value">{formatRatePerMillion(rates!.cacheWritePerM!)}</span>
                {overrides.has("cacheWritePerM") ? <span className="model-spec-chip-badge">手动</span> : null}
              </span>
            ) : null,
          ].filter(Boolean)
        : null}
    </div>
  );
}

export function CandidateModelSpecPanel({ candidate }: { candidate?: CandidateModelView }) {
  if (!candidate) {
    return (
      <div className="candidate-model-spec-panel candidate-model-spec-panel-empty">
        <div className="candidate-model-spec-panel-header">
          <Layers size={15} strokeWidth={2} className="candidate-model-spec-panel-icon" />
          <span className="candidate-model-spec-panel-title">模型规格</span>
        </div>
        <p className="candidate-model-spec-panel-hint">请选择候选模型以查看规格信息。</p>
      </div>
    );
  }

  const capability = candidateCapabilityHint(candidate);
  const pricing = candidatePricingHint(candidate);
  const mappingLabel = formatCandidateModelsDevLabel(candidate);
  const overriddenFields = candidateOverrideFields(candidate);
  const hasSummary = Boolean(capability || pricing);

  return (
    <div className="candidate-model-spec-panel">
      <div className="candidate-model-spec-panel-header">
        <Layers size={15} strokeWidth={2} className="candidate-model-spec-panel-icon" />
        <span className="candidate-model-spec-panel-title">模型规格</span>
        {mappingLabel ? (
          <span className="candidate-model-spec-panel-mapping" title="models.dev 映射">
            {mappingLabel}
          </span>
        ) : (
          <span className="candidate-model-spec-panel-mapping candidate-model-spec-panel-mapping-unresolved">
            未映射
          </span>
        )}
      </div>
      {!mappingLabel ? (
        <p className="candidate-model-spec-panel-hint candidate-model-spec-panel-hint-warn">
          请在 Provider 候选模型中配置 models.dev 映射。
        </p>
      ) : null}
      {hasSummary ? (
        <ModelSpecSummary
          {...(capability ? { capability } : {})}
          {...(pricing ? { pricing } : {})}
          {...(overriddenFields ? { overriddenFields } : {})}
        />
      ) : (
        <p className="candidate-model-spec-panel-hint">暂无规格数据。</p>
      )}
    </div>
  );
}
