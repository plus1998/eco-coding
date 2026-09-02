import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelsDevMapping, RouteCapabilityHint, RoutePricingHint } from "../shared/ipc";
import { multiplyUnitRate } from "../shared/manual-spec-pricing";
import {
  catalogCapabilityHint,
  catalogPricingHint,
  countManualOverrides,
  formatCatalogMappingLabel,
  formatTokenCountHint,
  listManualOverrideFields,
  type ManualSpecFormFields,
  type ManualTriState,
  mergeEffectiveCapabilityHint,
  mergeEffectivePricingHint,
  parsePriceMultiplierFormValue,
  tryFormToManualSpec,
} from "./agent-resource-manual-spec-form";
import { ModelsDevCatalogReferencePanel } from "./ModelSpecSummary";

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
  const { t } = useTranslation();
  const options: Array<{ value: ManualTriState; label: string }> = [
    { value: "auto", label: t("modelSpec.auto") },
    { value: "yes", label: t("modelSpec.supported") },
    { value: "no", label: t("modelSpec.unsupported") },
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
  const { t } = useTranslation();
  const isSidebar = variant === "sidebar";
  const overrideCount = countManualOverrides(value);
  const [expanded, setExpanded] = useState(() => isSidebar || overrideCount > 0);

  const catalogCapability = catalogCapabilityHint(autoCapability);
  const catalogPricing = catalogPricingHint(autoPricing);

  const autoContextHint = formatTokenCountHint(catalogCapability?.contextTokens);
  const autoOutputHint = formatTokenCountHint(catalogCapability?.maxOutputTokens);
  const autoImageHint =
    catalogCapability?.supportsImageInput === true
      ? t("modelSpec.supported")
      : catalogCapability?.supportsImageInput === false
        ? t("modelSpec.unsupported")
        : undefined;
  const autoReasoningHint =
    catalogCapability?.supportsReasoning === true
      ? t("modelSpec.supported")
      : catalogCapability?.supportsReasoning === false
        ? t("modelSpec.unsupported")
        : undefined;

  const title =
    overrideCount > 0
      ? t("modelSpec.manualOverridesCount", { count: overrideCount })
      : t("modelSpec.manualOverrides");

  const multiplier = parsePriceMultiplierFormValue(value.priceMultiplier);
  const catalogRates = catalogPricing?.rates;
  const effectiveInputPerM = multiplyUnitRate(catalogRates?.inputPerM, multiplier);
  const effectiveOutputPerM = multiplyUnitRate(catalogRates?.outputPerM, multiplier);
  const effectiveCacheReadPerM = multiplyUnitRate(catalogRates?.cacheReadPerM, multiplier);
  const effectiveCacheWritePerM = multiplyUnitRate(catalogRates?.cacheWritePerM, multiplier);
  const catalogMappingLabel = formatCatalogMappingLabel(autoCapability, autoPricing, mapping);
  const multiplierCaption =
    catalogRates?.inputPerM !== undefined && catalogRates.outputPerM !== undefined
      ? t("modelSpec.multiplierCaption", {
          catalogInput: catalogRates.inputPerM,
          catalogOutput: catalogRates.outputPerM,
          effectiveInput: formatRateHint(effectiveInputPerM),
          effectiveOutput: formatRateHint(effectiveOutputPerM),
        })
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
        <h4 className="model-spec-form-section-title">{t("modelSpec.contextAndOutput")}</h4>
        <div className="model-spec-form-grid">
          <NumericField
            label={t("modelSpec.contextLimit")}
            value={value.contextTokens}
            placeholder={autoContextHint ?? "tokens"}
            {...(autoContextHint ? { caption: t("modelSpec.catalogHint", { hint: autoContextHint }) } : {})}
            {...(disabled !== undefined ? { disabled } : {})}
            onChange={(contextTokens) => onChange({ contextTokens })}
          />
          <NumericField
            label={t("modelSpec.maxOutput")}
            value={value.maxOutputTokens}
            placeholder={autoOutputHint ?? "tokens"}
            {...(autoOutputHint ? { caption: t("modelSpec.catalogHint", { hint: autoOutputHint }) } : {})}
            {...(disabled !== undefined ? { disabled } : {})}
            onChange={(maxOutputTokens) => onChange({ maxOutputTokens })}
          />
        </div>
      </section>

      <section className="model-spec-form-section">
        <h4 className="model-spec-form-section-title">{t("modelSpec.capabilities")}</h4>
        <div className="model-spec-form-grid model-spec-form-grid--stack">
          <TriStateField
            label={t("modelSpec.multimodal")}
            {...(autoImageHint ? { hint: autoImageHint } : {})}
            value={value.supportsImageInput}
            {...(disabled !== undefined ? { disabled } : {})}
            onChange={(supportsImageInput) => onChange({ supportsImageInput })}
          />
          <TriStateField
            label={t("modelSpec.reasoning")}
            {...(autoReasoningHint ? { hint: autoReasoningHint } : {})}
            value={value.supportsReasoning}
            {...(disabled !== undefined ? { disabled } : {})}
            onChange={(supportsReasoning) => onChange({ supportsReasoning })}
          />
          <label className="model-spec-field model-spec-field-checkbox">
            <input
              type="checkbox"
              checked={value.supportsNativeWebSearch}
              disabled={disabled}
              onChange={(event) => onChange({ supportsNativeWebSearch: event.target.checked })}
            />
            <span className="model-spec-field-label">{t("modelSpec.nativeWebSearch")}</span>
          </label>
        </div>
      </section>

      <section className="model-spec-form-section">
        <h4 className="model-spec-form-section-title">{t("modelSpec.pricing")}</h4>
        <div className="model-spec-form-grid model-spec-form-grid--pricing">
          <NumericField
            label={t("modelSpec.input")}
            value={value.inputPerM}
            placeholder={formatRatePlaceholder(
              catalogRates?.inputPerM,
              effectiveInputPerM,
              t("modelSpec.input"),
            )}
            {...(disabled !== undefined ? { disabled } : {})}
            inputMode="decimal"
            onChange={(inputPerM) => onChange({ inputPerM })}
          />
          <NumericField
            label={t("modelSpec.output")}
            value={value.outputPerM}
            placeholder={formatRatePlaceholder(
              catalogRates?.outputPerM,
              effectiveOutputPerM,
              t("modelSpec.output"),
            )}
            {...(disabled !== undefined ? { disabled } : {})}
            inputMode="decimal"
            onChange={(outputPerM) => onChange({ outputPerM })}
          />
          <NumericField
            label={t("modelSpec.cacheRead")}
            value={value.cacheReadPerM}
            placeholder={formatRatePlaceholder(
              catalogRates?.cacheReadPerM,
              effectiveCacheReadPerM,
              t("modelSpec.cacheRead"),
            )}
            {...(disabled !== undefined ? { disabled } : {})}
            inputMode="decimal"
            onChange={(cacheReadPerM) => onChange({ cacheReadPerM })}
          />
          <NumericField
            label={t("modelSpec.cacheWrite")}
            value={value.cacheWritePerM}
            placeholder={formatRatePlaceholder(
              catalogRates?.cacheWritePerM,
              effectiveCacheWritePerM,
              t("modelSpec.cacheWrite"),
            )}
            {...(disabled !== undefined ? { disabled } : {})}
            inputMode="decimal"
            onChange={(cacheWritePerM) => onChange({ cacheWritePerM })}
          />
        </div>
      </section>

      <section className="model-spec-form-section model-spec-form-section--multiplier">
        <NumericField
          label={t("modelSpec.priceMultiplier")}
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
            <span className="model-manual-spec-sidebar-badge">
              {t("modelSpec.overrideCount", { count: overrideCount })}
            </span>
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

function formatRatePlaceholder(catalog?: number, effective?: number, label?: string): string {
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
