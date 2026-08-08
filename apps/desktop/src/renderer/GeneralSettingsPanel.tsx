import { Laptop, Minus, Moon, Plus, Sun } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getRuntimePlatformLabel } from "./runtime-platform";
import type { AppTheme } from "./theme";
import {
  CODE_FONT_SIZE_RANGE,
  type TypographyPreferences,
  UI_FONT_SIZE_RANGE,
} from "./typography-preferences";

interface GeneralSettingsPanelProps {
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  typography: TypographyPreferences;
  onTypographyChange: (preferences: TypographyPreferences) => void;
}

interface FontSizeControlProps {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

function FontSizeControl({ label, description, value, min, max, onChange }: FontSizeControlProps) {
  const { t } = useTranslation();
  return (
    <li className="typography-settings-row">
      <span className="settings-row-main">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span className="font-size-stepper">
        <button
          type="button"
          className="font-size-stepper-button"
          aria-label={t("settings.decrease", { label })}
          title={t("settings.decrease", { label })}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
        >
          <Minus size={14} />
        </button>
        <span className="font-size-stepper-value" aria-live="polite">
          {value}
          <small>px</small>
        </span>
        <button
          type="button"
          className="font-size-stepper-button"
          aria-label={t("settings.increase", { label })}
          title={t("settings.increase", { label })}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
        >
          <Plus size={14} />
        </button>
      </span>
    </li>
  );
}

export function GeneralSettingsPanel({
  theme,
  onThemeChange,
  typography,
  onTypographyChange,
}: GeneralSettingsPanelProps) {
  const { t } = useTranslation();
  const themeOptions = useMemo(() => {
    const platformLabel = getRuntimePlatformLabel();
    return [
      {
        id: "system" as const,
        label: t("common.system"),
        description: t("settings.theme.systemDescription", { platform: platformLabel }),
        icon: Laptop,
      },
      {
        id: "dark" as const,
        label: t("settings.theme.dark"),
        description: t("settings.theme.darkDescription"),
        icon: Moon,
      },
      {
        id: "light" as const,
        label: t("settings.theme.light"),
        description: t("settings.theme.lightDescription"),
        icon: Sun,
      },
    ];
  }, [t]);

  return (
    <>
      <header className="settings-page-header">
        <h1>{t("settings.general")}</h1>
      </header>

      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <span className="settings-section-label">{t("settings.theme")}</span>
            <p className="settings-section-subtitle">{t("settings.themeSubtitle")}</p>
          </div>
        </div>

        <div className="theme-picker" role="radiogroup" aria-label={t("settings.themeAria")}>
          {themeOptions.map((option) => {
            const Icon = option.icon;
            const selected = theme === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={selected ? "theme-picker-card active" : "theme-picker-card"}
                onClick={() => onThemeChange(option.id)}
              >
                <span className="theme-picker-card-radio" aria-hidden />
                <span className="theme-picker-card-icon" aria-hidden>
                  <Icon size={20} />
                </span>
                <span className="theme-picker-card-body">
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <span className="settings-section-label">{t("settings.fonts")}</span>
            <p className="settings-section-subtitle">{t("settings.fontsSubtitle")}</p>
          </div>
        </div>

        <ul className="settings-rows">
          <FontSizeControl
            label={t("settings.uiFontSize")}
            description={t("settings.uiFontDescription")}
            value={typography.uiFontSize}
            min={UI_FONT_SIZE_RANGE.min}
            max={UI_FONT_SIZE_RANGE.max}
            onChange={(uiFontSize) => onTypographyChange({ ...typography, uiFontSize })}
          />
          <FontSizeControl
            label={t("settings.codeFontSize")}
            description={t("settings.codeFontDescription")}
            value={typography.codeFontSize}
            min={CODE_FONT_SIZE_RANGE.min}
            max={CODE_FONT_SIZE_RANGE.max}
            onChange={(codeFontSize) => onTypographyChange({ ...typography, codeFontSize })}
          />
        </ul>
      </section>
    </>
  );
}
