import { useMemo, useState } from "react";
import type { ModelsDevMapping, RouteCapabilityHint, RoutePricingHint } from "../shared/ipc";
import {
  catalogCapabilityHint,
  catalogPricingHint,
  countManualOverrides,
  formatCatalogMappingLabel,
  formatTokenCountHint,
  listManualOverrideFields,
  mergeEffectiveCapabilityHint,
  mergeEffectivePricingHint,
  parsePriceMultiplierFormValue,
  tryFormToManualSpec,
  type ManualSpecFormFields,
  type ManualTriState,
} from "./agent-profile-manual-spec-form";
import { ModelsDevCatalogReferencePanel } from "./ModelSpecSummary";
import { multiplyUnitRate } from "../shared/manual-spec-pricing";

interface ModelManualSpecPanelProps {
  value: ManualSpecFormFields;
  autoCapability?: RouteCapabilityHint;
  autoPricing?: RoutePricingHint;
  mapping?: ModelsDevMapping;
  disabled?: boolean;
  /** sidebar = 候选模型侧栏，单列对齐布局 */
  variant?: "default" | "sidebar";
  onChange: (patch: Partial<ManualSpecFormFields>) => void;
}

function TriStateField({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: ManualTriState;
  disabled?: boolean;
  onChange: (value: ManualTriState) => void;
}) {
  const options: Array<{ value: ManualTriState; label: string }> = [
    { value: "auto", label: "自动" },
    { value: "yes", label: "支持" },
    { value: "no", label: "不支持" },
  ];
  return (
    <div className="model-spec-field model-spec-field-tristate">
      <span className="model-spec-field-label">{label}</span>
      {hint ? <span className="model-spec-field-caption">catalog · {hint}</span> : null}
      <div className="model-spec-segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`model-spec-segmented-btn${value === option.value ? " is-active" : ""}`}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NumericField({
  label,
  value,
  placeholder,
  caption,
  disabled,
  inputMode = "numeric",
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  caption?: string;
  disabled?: boolean;
  inputMode?: "numeric" | "decimal";
  onChange: (value: string) => void;
}) {
  return (
    <label className="model-spec-field">
      <span className="model-spec-field-label">{label}</span>
      <input
        className="model-spec-field-input"
        type="text"
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {caption ? <span className="model-spec-field-caption">{caption}</span> : null}
    </label>
  );
}

export function ModelManualSpecPanel({
  value,
  autoCapability,
  autoPricing,
  mapping,
  disabled,
  variant = "default",
  onChange,
}: ModelManualSpecPanelProps) {
  const isSidebar = variant === "sidebar";
  const overrideCount = countManualOverrides(value);
  const [expanded, setExpanded] = useState(() => isSidebar || overrideCount > 0);

  const catalogCapability = catalogCapabilityHint(autoCapability);
  const catalogPricing = catalogPricingHint(autoPricing);

  const autoContextHint = formatTokenCountHint(catalogCapability?.contextTokens);
  const autoOutputHint = formatTokenCountHint(catalogCapability?.maxOutputTokens);
  const autoImageHint =
    catalogCapability?.supportsImageInput === true
      ? "支持"
      : catalogCapability?.supportsImageInput === false
        ? "不支持"
        : undefined;
  const autoReasoningHint =
    catalogCapability?.supportsReasoning === true
      ? "支持"
      : catalogCapability?.supportsReasoning === false
        ? "不支持"
        : undefined;

  const title =
    overrideCount > 0 ? `手动覆盖 (${overrideCount})` : "手动覆盖";

  const multiplier = parsePriceMultiplierFormValue(value.priceMultiplier);
  const catalogRates = catalogPricing?.rates;
  const effectiveInputPerM = multiplyUnitRate(catalogRates?.inputPerM, multiplier);
  const effectiveOutputPerM = multiplyUnitRate(catalogRates?.outputPerM, multiplier);
  const effectiveCacheReadPerM = multiplyUnitRate(catalogRates?.cacheReadPerM, multiplier);
  const effectiveCacheWritePerM = multiplyUnitRate(catalogRates?.cacheWritePerM, multiplier);
  const catalogMappingLabel = formatCatalogMappingLabel(autoCapability, autoPricing, mapping);
  const multiplierCaption =
    catalogRates?.inputPerM !== undefined && catalogRates.outputPerM !== undefined
      ? `正价 $${catalogRates.inputPerM} / $${catalogRates.outputPerM} → 实际 $${formatRateHint(effectiveInputPerM)} / $${formatRateHint(effectiveOutputPerM)}`
      : undefined;

  const body = (
    <div className="model-manual-spec-body">
      <ModelsDevCatalogReferencePanel
        compact
        {...(autoCapability ? { capability: autoCapability } : {})}
        {...(autoPricing ? { pricing: autoPricing } : {})}
        {...(catalogMappingLabel ? { mappingLabel: catalogMappingLabel } : {})}
      />

      <section className="model-spec-form-section">
        <h4 className="model-spec-form-section-title">上下文与输出</h4>
        <div className="model-spec-form-grid">
          <NumericField
            label="上下文上限"
            value={value.contextTokens}
            placeholder={autoContextHint ?? "tokens"}
            {...(autoContextHint ? { caption: `catalog · ${autoContextHint}` } : {})}
            {...(disabled !== undefined ? { disabled } : {})}
            onChange={(contextTokens) => onChange({ contextTokens })}
          />
          <NumericField
            label="最大输出"
            value={value.maxOutputTokens}
            placeholder={autoOutputHint ?? "tokens"}
            {...(autoOutputHint ? { caption: `catalog · ${autoOutputHint}` } : {})}
            {...(disabled !== undefined ? { disabled } : {})}
            onChange={(maxOutputTokens) => onChange({ maxOutputTokens })}
          />
        </div>
      </section>

      <section className="model-spec-form-section">
        <h4 className="model-spec-form-section-title">模型能力</h4>
        <div className="model-spec-form-grid model-spec-form-grid--stack">
          <TriStateField
            label="多模态"
            {...(autoImageHint ? { hint: autoImageHint } : {})}
            value={value.supportsImageInput}
            {...(disabled !== undefined ? { disabled } : {})}
            onChange={(supportsImageInput) => onChange({ supportsImageInput })}
          />
          <TriStateField
            label="推理"
            {...(autoReasoningHint ? { hint: autoReasoningHint } : {})}
            value={value.supportsReasoning}
            {...(disabled !== undefined ? { disabled } : {})}
            onChange={(supportsReasoning) => onChange({ supportsReasoning })}
          />
        </div>
      </section>

      <section className="model-spec-form-section">
        <h4 className="model-spec-form-section-title">定价 ($/M)</h4>
        <div className="model-spec-form-grid model-spec-form-grid--pricing">
          <NumericField
            label="输入"
            value={value.inputPerM}
            placeholder={formatRatePlaceholder(catalogRates?.inputPerM, effectiveInputPerM, "输入")}
            {...(disabled !== undefined ? { disabled } : {})}
            inputMode="decimal"
            onChange={(inputPerM) => onChange({ inputPerM })}
          />
          <NumericField
            label="输出"
            value={value.outputPerM}
            placeholder={formatRatePlaceholder(catalogRates?.outputPerM, effectiveOutputPerM, "输出")}
            {...(disabled !== undefined ? { disabled } : {})}
            inputMode="decimal"
            onChange={(outputPerM) => onChange({ outputPerM })}
          />
          <NumericField
            label="缓存读"
            value={value.cacheReadPerM}
            placeholder={formatRatePlaceholder(catalogRates?.cacheReadPerM, effectiveCacheReadPerM, "缓存读")}
            {...(disabled !== undefined ? { disabled } : {})}
            inputMode="decimal"
            onChange={(cacheReadPerM) => onChange({ cacheReadPerM })}
          />
          <NumericField
            label="缓存写"
            value={value.cacheWritePerM}
            placeholder={formatRatePlaceholder(catalogRates?.cacheWritePerM, effectiveCacheWritePerM, "缓存写")}
            {...(disabled !== undefined ? { disabled } : {})}
            inputMode="decimal"
            onChange={(cacheWritePerM) => onChange({ cacheWritePerM })}
          />
        </div>
      </section>

      <section className="model-spec-form-section model-spec-form-section--multiplier">
        <NumericField
          label="价格倍率"
          value={value.priceMultiplier}
          placeholder="x1"
          {...(multiplierCaption ? { caption: multiplierCaption } : {})}
          {...(disabled !== undefined ? { disabled } : {})}
          inputMode="decimal"
          onChange={(priceMultiplier) => onChange({ priceMultiplier })}
        />
      </section>
    </div>
  );

  if (isSidebar) {
    return (
      <div className="model-manual-spec model-manual-spec--sidebar">
        <div className="model-manual-spec-sidebar-head">
          <h3 className="model-manual-spec-sidebar-title">{title}</h3>
          {overrideCount > 0 ? (
            <span className="model-manual-spec-sidebar-badge">{overrideCount} 项</span>
          ) : null}
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="model-manual-spec">
      <button
        type="button"
        className="model-manual-spec-toggle"
        aria-expanded={expanded}
        disabled={disabled}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>{expanded ? "▼" : "▶"}</span>
        <span>{title}</span>
      </button>
      {expanded ? body : null}
    </div>
  );
}

function formatRatePlaceholder(
  catalog?: number,
  effective?: number,
  label?: string,
): string {
  if (effective !== undefined) {
    return `$${formatRateHint(effective)}`;
  }
  if (catalog !== undefined) {
    return `$${formatRateHint(catalog)}`;
  }
  return label ?? "—";
}

function formatRateHint(value: number | undefined): string {
  if (value === undefined) {
    return "—";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, "");
}

export function useEffectiveModelSpecHints(
  autoCapability: RouteCapabilityHint | undefined,
  autoPricing: RoutePricingHint | undefined,
  manualForm: ManualSpecFormFields,
) {
  return useMemo(() => {
    const overriddenFields = listManualOverrideFields(manualForm);
    const parsedManualSpec = tryFormToManualSpec(manualForm);
    return {
      capability: mergeEffectiveCapabilityHint(autoCapability, parsedManualSpec),
      pricing: mergeEffectivePricingHint(autoPricing, parsedManualSpec),
      overriddenFields,
    };
  }, [autoCapability, autoPricing, manualForm]);
}
