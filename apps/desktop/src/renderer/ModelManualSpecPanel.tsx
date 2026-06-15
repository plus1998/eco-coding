import { useMemo, useState } from "react";
import type { RouteCapabilityHint, RoutePricingHint } from "../shared/ipc";
import {
  catalogCapabilityHint,
  catalogPricingHint,
  countManualOverrides,
  formatTokenCountHint,
  listManualOverrideFields,
  mergeEffectiveCapabilityHint,
  mergeEffectivePricingHint,
  tryFormToManualSpec,
  type ManualSpecFormFields,
  type ManualTriState,
} from "./agent-profile-manual-spec-form";

interface ModelManualSpecPanelProps {
  value: ManualSpecFormFields;
  autoCapability?: RouteCapabilityHint;
  autoPricing?: RoutePricingHint;
  disabled?: boolean;
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
    <div className="mcp-field model-manual-spec-tristate-field">
      <span className="mcp-field-label">
        {label}
        {hint ? <span className="model-manual-spec-auto-hint">自动: {hint}</span> : null}
      </span>
      <div className="model-manual-spec-tristate" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`model-manual-spec-tristate-btn${value === option.value ? " active" : ""}`}
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
  autoHint,
  disabled,
  inputMode = "numeric",
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  autoHint?: string;
  disabled?: boolean;
  inputMode?: "numeric" | "decimal";
  onChange: (value: string) => void;
}) {
  return (
    <label className="mcp-field models-route-manual-field">
      <span className="mcp-field-label">
        {label}
        {autoHint ? <span className="model-manual-spec-auto-hint">自动: {autoHint}</span> : null}
      </span>
      <input
        className="mcp-field-input"
        type="text"
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function ModelManualSpecPanel({
  value,
  autoCapability,
  autoPricing,
  disabled,
  onChange,
}: ModelManualSpecPanelProps) {
  const overrideCount = countManualOverrides(value);
  const [expanded, setExpanded] = useState(() => overrideCount > 0);

  const autoContextHint = formatTokenCountHint(autoCapability?.contextTokens);
  const autoOutputHint = formatTokenCountHint(autoCapability?.maxOutputTokens);
  const autoImageHint =
    autoCapability?.supportsImageInput === true
      ? "支持"
      : autoCapability?.supportsImageInput === false
        ? "不支持"
        : undefined;
  const autoReasoningHint =
    autoCapability?.supportsReasoning === true
      ? "支持"
      : autoCapability?.supportsReasoning === false
        ? "不支持"
        : undefined;

  const title =
    overrideCount > 0 ? `手动覆盖规格 (${overrideCount} 项已覆盖)` : "手动覆盖规格";

  return (
    <div className="models-route-manual-spec">
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
      {expanded ? (
        <div className="model-manual-spec-body">
          <div className="model-manual-spec-section">
            <span className="model-manual-spec-section-title">上下文与输出</span>
            <div className="models-route-manual-spec-grid">
              <NumericField
                label="上下文上限 (tokens)"
                value={value.contextTokens}
                placeholder={autoContextHint ? `自动: ${autoContextHint}` : "留空则使用 models.dev"}
                {...(autoContextHint ? { autoHint: autoContextHint } : {})}
                {...(disabled !== undefined ? { disabled } : {})}
                onChange={(contextTokens) => onChange({ contextTokens })}
              />
              <NumericField
                label="最大输出 (tokens)"
                value={value.maxOutputTokens}
                placeholder={autoOutputHint ? `自动: ${autoOutputHint}` : "留空则使用 models.dev"}
                {...(autoOutputHint ? { autoHint: autoOutputHint } : {})}
                {...(disabled !== undefined ? { disabled } : {})}
                onChange={(maxOutputTokens) => onChange({ maxOutputTokens })}
              />
            </div>
          </div>

          <div className="model-manual-spec-section">
            <span className="model-manual-spec-section-title">模型能力</span>
            <div className="model-manual-spec-tristate-grid">
              <TriStateField
                label="多模态 (图像输入)"
                {...(autoImageHint ? { hint: autoImageHint } : {})}
                value={value.supportsImageInput}
                {...(disabled !== undefined ? { disabled } : {})}
                onChange={(supportsImageInput) => onChange({ supportsImageInput })}
              />
              <TriStateField
                label="推理能力"
                {...(autoReasoningHint ? { hint: autoReasoningHint } : {})}
                value={value.supportsReasoning}
                {...(disabled !== undefined ? { disabled } : {})}
                onChange={(supportsReasoning) => onChange({ supportsReasoning })}
              />
            </div>
          </div>

          <div className="model-manual-spec-section">
            <span className="model-manual-spec-section-title">定价 ($/M tokens)</span>
            <div className="models-route-manual-spec-grid">
              <NumericField
                label="输入"
                value={value.inputPerM}
                placeholder={
                  autoPricing?.rates?.inputPerM !== undefined
                    ? `自动: $${autoPricing.rates.inputPerM}`
                    : "留空则使用 models.dev"
                }
                {...(disabled !== undefined ? { disabled } : {})}
                inputMode="decimal"
                onChange={(inputPerM) => onChange({ inputPerM })}
              />
              <NumericField
                label="输出"
                value={value.outputPerM}
                placeholder={
                  autoPricing?.rates?.outputPerM !== undefined
                    ? `自动: $${autoPricing.rates.outputPerM}`
                    : "留空则使用 models.dev"
                }
                {...(disabled !== undefined ? { disabled } : {})}
                inputMode="decimal"
                onChange={(outputPerM) => onChange({ outputPerM })}
              />
              <NumericField
                label="缓存读"
                value={value.cacheReadPerM}
                placeholder={
                  autoPricing?.rates?.cacheReadPerM !== undefined
                    ? `自动: $${autoPricing.rates.cacheReadPerM}`
                    : "可选"
                }
                {...(disabled !== undefined ? { disabled } : {})}
                inputMode="decimal"
                onChange={(cacheReadPerM) => onChange({ cacheReadPerM })}
              />
              <NumericField
                label="缓存写"
                value={value.cacheWritePerM}
                placeholder={
                  autoPricing?.rates?.cacheWritePerM !== undefined
                    ? `自动: $${autoPricing.rates.cacheWritePerM}`
                    : "可选"
                }
                {...(disabled !== undefined ? { disabled } : {})}
                inputMode="decimal"
                onChange={(cacheWritePerM) => onChange({ cacheWritePerM })}
              />
            </div>
          </div>

          <span className="mcp-field-hint">
            留空或选「自动」则使用 models.dev 匹配值；填写后手动值优先于 catalog。
          </span>
        </div>
      ) : null}
    </div>
  );
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
