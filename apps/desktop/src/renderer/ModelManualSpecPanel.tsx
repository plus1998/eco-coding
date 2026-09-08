import { useId, useMemo, useRef, useState } from "react";
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

const CONTEXT_PRESETS = [131_072, 262_144, 524_288, 1_048_576];
const OUTPUT_PRESETS = [8_192, 16_384, 32_768, 65_536, 131_072, 262_144];

function formatTokenPresetLabel(value: number): string {
  if (value >= 1_048_576 && value % 1_048_576 === 0) {
    return `${value / 1_048_576}M`;
  }
  return `${value / 1024}K`;
}

function parseTokenInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  let multiplier = 1;
  let numericPart = lower;
  if (lower.endsWith("k")) {
    multiplier = 1024;
    numericPart = lower.slice(0, -1);
  } else if (lower.endsWith("m")) {
    multiplier = 1048576;
    numericPart = lower.slice(0, -1);
  }
  const parsed = Number(numericPart);
  if (Number.isNaN(parsed)) return undefined;
  return Math.round(parsed * multiplier);
}

function TokenPresetField({
  label,
  value,
  presets,
  placeholder,
  caption,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  presets: readonly number[];
  placeholder?: string;
  caption?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const currentValue = parseTokenInput(value);
  const isPreset = presets.some((p) => p === currentValue);

  function startEditing() {
    setDraft(value);
    setEditing(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }

  function cancelEditing() {
    setEditing(false);
    setDraft("");
  }

  function saveEditing() {
    onChange(draft);
    setEditing(false);
    setDraft("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      saveEditing();
    } else if (event.key === "Escape") {
      cancelEditing();
    }
  }

  if (editing) {
    return (
      <label className="model-spec-field">
        <span className="model-spec-field-label">{label}</span>
        <div className="model-spec-preset-edit-row">
          <input
            ref={inputRef}
            className="model-spec-field-input"
            type="text"
            inputMode="numeric"
            placeholder={placeholder}
            value={draft}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            className="model-spec-preset-edit-btn model-spec-preset-edit-btn-save"
            onClick={saveEditing}
            disabled={disabled}
          >
            保存
          </button>
          <button
            type="button"
            className="model-spec-preset-edit-btn"
            onClick={cancelEditing}
            disabled={disabled}
          >
            取消
          </button>
        </div>
        {caption ? <span className="model-spec-field-caption">{caption}</span> : null}
      </label>
    );
  }

  return (
    <label className="model-spec-field">
      <span className="model-spec-field-label">{label}</span>
      <div className="model-spec-preset-row">
        <select
          className="model-spec-preset-select"
          value={isPreset ? String(currentValue) : ""}
          disabled={disabled}
          onChange={(event) => {
            const selected = event.target.value;
            if (selected) {
              onChange(selected);
            }
          }}
        >
          <option value="">选择...</option>
          {presets.map((preset) => (
            <option key={preset} value={preset}>
              {formatTokenPresetLabel(preset)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="model-spec-preset-edit-icon-btn"
          onClick={startEditing}
          disabled={disabled}
          aria-label={`编辑${label}`}
          title={`手动输入${label}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </div>
      {caption ? <span className="model-spec-field-caption">{caption}</span> : null}
      {value && !isPreset ? (
        <span className="model-spec-field-caption model-spec-field-caption-custom">自定义：{value}</span>
      ) : null}
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
  const nativeWebSearchLabelId = useId();
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
          <TokenPresetField
            label={t("modelSpec.contextLimit")}
            value={value.contextTokens}
            presets={CONTEXT_PRESETS}
            placeholder={autoContextHint ?? "tokens"}
            {...(autoContextHint ? { caption: t("modelSpec.catalogHint", { hint: autoContextHint }) } : {})}
            {...(disabled !== undefined ? { disabled } : {})}
            onChange={(contextTokens) => onChange({ contextTokens })}
          />
          <TokenPresetField
            label={t("modelSpec.maxOutput")}
            value={value.maxOutputTokens}
            presets={OUTPUT_PRESETS}
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
            <span className="model-spec-field-label" id={nativeWebSearchLabelId}>
              {t("modelSpec.nativeWebSearch")}
            </span>
            <span
              className="mcp-toggle mcp-toggle-sm"
              title={
                value.supportsNativeWebSearch
                  ? t("modelSpec.nativeWebSearch")
                  : t("modelSpec.nativeWebSearchOff")
              }
            >
              <input
                type="checkbox"
                checked={value.supportsNativeWebSearch}
                disabled={disabled}
                aria-labelledby={nativeWebSearchLabelId}
                onChange={(event) => onChange({ supportsNativeWebSearch: event.target.checked })}
              />
              <span className="mcp-toggle-track" aria-hidden />
            </span>
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
