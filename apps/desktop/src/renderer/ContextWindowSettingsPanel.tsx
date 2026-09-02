import {
  GLOBAL_CONTEXT_WINDOW_LIMIT_MAX,
  GLOBAL_CONTEXT_WINDOW_LIMIT_MIN,
  GLOBAL_CONTEXT_WINDOW_LIMIT_PRESETS,
  GLOBAL_CONTEXT_WINDOW_LIMIT_STEP,
  GLOBAL_MAX_OUTPUT_TOKEN_MAX,
  GLOBAL_MAX_OUTPUT_TOKEN_MIN,
  GLOBAL_MAX_OUTPUT_TOKEN_PRESETS,
  GLOBAL_MAX_OUTPUT_TOKEN_STEP,
  type GlobalContextWindowLimit,
  type GlobalMaxOutputTokens,
} from "@eco/runtime/models-dev-limits";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const contextPresetFlags = GLOBAL_CONTEXT_WINDOW_LIMIT_PRESETS.map((value) => ({
  value,
  label: formatBinaryK(value),
}));

const maxOutputPresetFlags = GLOBAL_MAX_OUTPUT_TOKEN_PRESETS.map((value) => ({
  value,
  label: formatBinaryK(value),
}));

/** Binary-friendly label for values on the 1KiB grid (262144 -> "256K"). */
function formatBinaryK(value: number): string {
  if (value >= 1_048_576 && value % 1_048_576 === 0) {
    return `${value / 1_048_576}M`;
  }
  return `${value / 1024}K`;
}

function formatContextValue(value: number, flags: ReadonlyArray<{ value: number; label: string }>) {
  const flag = flags.find((entry) => entry.value === value);
  return flag ? flag.label : formatBinaryK(value);
}

function formatMaxOutputValue(value: number, flags: ReadonlyArray<{ value: number; label: string }>) {
  const flag = flags.find((entry) => entry.value === value);
  return flag ? flag.label : formatBinaryK(value);
}

interface TokenSliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  flags: ReadonlyArray<{ value: number; label: string }>;
  format: (value: number) => string;
  ariaLabel: string;
  disabled?: boolean;
  onCommit: (value: number) => void;
}

function TokenSlider({
  min,
  max,
  step,
  value,
  flags,
  format,
  ariaLabel,
  disabled,
  onCommit,
}: TokenSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const displayValue = dragValue ?? value;

  function quantize(raw: number): number {
    let next = Math.round(raw / step) * step;
    next = Math.min(max, Math.max(min, next));
    for (const flag of flags) {
      if (Math.abs(next - flag.value) <= step) {
        next = flag.value;
        break;
      }
    }
    return next;
  }

  function valueFromClientX(clientX: number): number {
    const track = trackRef.current;
    if (!track) {
      return quantize(value);
    }
    const rect = track.getBoundingClientRect();
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return quantize(min + Math.min(1, Math.max(0, ratio)) * (max - min));
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled) {
      return;
    }
    event.preventDefault();
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    setDragValue(valueFromClientX(event.clientX));
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (dragValue === null || disabled) {
      return;
    }
    setDragValue(valueFromClientX(event.clientX));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragValue === null) {
      return;
    }
    const next = valueFromClientX(event.clientX);
    setDragValue(null);
    if (next !== value) {
      onCommit(next);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) {
      return;
    }
    let next: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      next = value - step;
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      next = value + step;
    } else if (event.key === "PageDown") {
      const below = [...flags].filter((flag) => flag.value < value).sort((a, b) => b.value - a.value);
      next = below[0]?.value ?? min;
    } else if (event.key === "PageUp") {
      const above = [...flags].filter((flag) => flag.value > value).sort((a, b) => a.value - b.value);
      next = above[0]?.value ?? max;
    } else if (event.key === "Home") {
      next = min;
    } else if (event.key === "End") {
      next = max;
    } else {
      return;
    }
    event.preventDefault();
    onCommit(quantize(next));
  }

  const positionPct = ((displayValue - min) / (max - min)) * 100;
  const isDragging = dragValue !== null;

  return (
    <div className={isDragging ? "token-slider is-dragging" : "token-slider"}>
      <div
        ref={trackRef}
        className={disabled ? "token-slider-track is-disabled" : "token-slider-track"}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={displayValue}
        aria-valuetext={format(displayValue)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <div className="token-slider-fill" style={{ width: `${positionPct}%` }} />
        {flags.map((flag) => {
          const flagPct = ((flag.value - min) / (max - min)) * 100;
          const isAtValue = value === flag.value;
          return (
            <div
              key={flag.value}
              className={isAtValue ? "token-slider-flag is-active" : "token-slider-flag"}
              style={{ left: `${flagPct}%` }}
            >
              <span className="token-slider-flag-dot" aria-hidden />
              <span className="token-slider-flag-label">{flag.label}</span>
            </div>
          );
        })}
        <div className="token-slider-handle" style={{ left: `${positionPct}%` }} aria-hidden>
          <span className="token-slider-value-badge">{format(displayValue)}</span>
        </div>
      </div>
    </div>
  );
}

interface ContextWindowSettingsPanelProps {
  contextWindowLimitTokens: number;
  maxOutputLimitTokens: number;
  onChangeContextWindow: (value: GlobalContextWindowLimit) => Promise<void>;
  onChangeMaxOutput: (value: GlobalMaxOutputTokens) => Promise<void>;
}

export function ContextWindowSettingsPanel({
  contextWindowLimitTokens,
  maxOutputLimitTokens,
  onChangeContextWindow,
  onChangeMaxOutput,
}: ContextWindowSettingsPanelProps) {
  const { t } = useTranslation();
  const [savingContext, setSavingContext] = useState(false);
  const [savingMaxOutput, setSavingMaxOutput] = useState(false);

  async function selectContext(next: number) {
    if (savingContext || next === contextWindowLimitTokens) {
      return;
    }
    setSavingContext(true);
    try {
      await onChangeContextWindow(next);
    } finally {
      setSavingContext(false);
    }
  }

  async function selectMaxOutput(next: number) {
    if (savingMaxOutput || next === maxOutputLimitTokens) {
      return;
    }
    setSavingMaxOutput(true);
    try {
      await onChangeMaxOutput(next);
    } finally {
      setSavingMaxOutput(false);
    }
  }

  return (
    <div className="token-limits-page">
      <header className="token-limits-page-header">
        <h1>{t("settings.contextWindow")}</h1>
      </header>

      <section className="token-limits-card">
        <div className="token-limits-head">
          <div className="token-limits-head-text">
            <span className="token-limits-title">{t("settings.contextWindow.limit")}</span>
            <p className="token-limits-subtitle">{t("settings.contextWindow.subtitle")}</p>
          </div>
          <span className="token-limits-readout">
            {t("settings.contextWindow.tokens", {
              tokens: contextWindowLimitTokens.toLocaleString(),
            })}
          </span>
        </div>

        <TokenSlider
          min={GLOBAL_CONTEXT_WINDOW_LIMIT_MIN}
          max={GLOBAL_CONTEXT_WINDOW_LIMIT_MAX}
          step={GLOBAL_CONTEXT_WINDOW_LIMIT_STEP}
          value={contextWindowLimitTokens}
          flags={contextPresetFlags}
          format={(value) => formatContextValue(value, contextPresetFlags)}
          ariaLabel={t("settings.contextWindow.limit")}
          disabled={savingContext}
          onCommit={(next) => void selectContext(next)}
        />
      </section>

      <section className="token-limits-card">
        <div className="token-limits-head">
          <div className="token-limits-head-text">
            <span className="token-limits-title">{t("settings.maxOutput.limit")}</span>
            <p className="token-limits-subtitle">{t("settings.maxOutput.subtitle")}</p>
          </div>
          <span className="token-limits-readout">
            {t("settings.maxOutput.tokens", {
              tokens: maxOutputLimitTokens.toLocaleString(),
            })}
          </span>
        </div>

        <TokenSlider
          min={GLOBAL_MAX_OUTPUT_TOKEN_MIN}
          max={GLOBAL_MAX_OUTPUT_TOKEN_MAX}
          step={GLOBAL_MAX_OUTPUT_TOKEN_STEP}
          value={maxOutputLimitTokens}
          flags={maxOutputPresetFlags}
          format={(value) => formatMaxOutputValue(value, maxOutputPresetFlags)}
          ariaLabel={t("settings.maxOutput.limit")}
          disabled={savingMaxOutput}
          onCommit={(next) => void selectMaxOutput(next)}
        />
      </section>
    </div>
  );
}
