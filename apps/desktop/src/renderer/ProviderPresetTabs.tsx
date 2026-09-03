import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderPresetDefinition } from "./provider-presets";

export function ProviderPresetIcon({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return null;
  }
  return (
    <img
      className="provider-preset-tab-icon"
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export function ProviderPresetTabs({
  presets,
  activePresetId,
  disabled,
  onSelectManual,
  onSelectPreset,
}: {
  presets: readonly ProviderPresetDefinition[];
  activePresetId?: string;
  disabled?: boolean;
  onSelectManual: () => void;
  onSelectPreset: (preset: ProviderPresetDefinition) => void;
}) {
  const { t } = useTranslation();
  const selectedId = activePresetId ?? "manual";

  return (
    <div
      className="provider-preset-tabs"
      role="tablist"
      aria-label={t("settings.models.provider.preset")}
    >
      <button
        type="button"
        role="tab"
        className={`provider-preset-tab${selectedId === "manual" ? " is-active" : ""}`}
        aria-selected={selectedId === "manual"}
        disabled={disabled}
        onClick={onSelectManual}
      >
        {t("settings.models.provider.manual")}
      </button>
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          role="tab"
          className={`provider-preset-tab${selectedId === preset.id ? " is-active" : ""}`}
          aria-selected={selectedId === preset.id}
          disabled={disabled}
          onClick={() => onSelectPreset(preset)}
        >
          <ProviderPresetIcon src={preset.iconSrc} />
          <span className="provider-preset-tab-label">{preset.name}</span>
        </button>
      ))}
    </div>
  );
}
