import { Laptop, Minus, Moon, Plus, Sun } from "lucide-react";
import { useMemo } from "react";
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
          aria-label={`减小${label}`}
          title={`减小${label}`}
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
          aria-label={`增大${label}`}
          title={`增大${label}`}
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
  const themeOptions = useMemo(() => {
    const platformLabel = getRuntimePlatformLabel();
    return [
      {
        id: "system" as const,
        label: "系统",
        description: `跟随${platformLabel}外观设置自动切换。`,
        icon: Laptop,
      },
      {
        id: "dark" as const,
        label: "深色",
        description: "适合低光环境，减轻眼睛疲劳。",
        icon: Moon,
      },
      {
        id: "light" as const,
        label: "浅色",
        description: "明亮清爽的浅色界面。",
        icon: Sun,
      },
    ];
  }, []);

  return (
    <>
      <header className="settings-page-header">
        <h1>外观</h1>
      </header>

      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <span className="settings-section-label">主题</span>
            <p className="settings-section-subtitle">主界面与设置页使用同一套配色。</p>
          </div>
        </div>

        <div className="theme-picker" role="radiogroup" aria-label="应用主题">
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
            <span className="settings-section-label">字体</span>
            <p className="settings-section-subtitle">分别调整界面文字与等宽代码内容。</p>
          </div>
        </div>

        <ul className="settings-rows">
          <FontSizeControl
            label="UI 字号"
            description="项目、会话、Feed 与工作面板的基础字号。"
            value={typography.uiFontSize}
            min={UI_FONT_SIZE_RANGE.min}
            max={UI_FONT_SIZE_RANGE.max}
            onChange={(uiFontSize) => onTypographyChange({ ...typography, uiFontSize })}
          />
          <FontSizeControl
            label="代码字体大小"
            description="代码审查、文件变更、Bash 与终端内容的基础字号。"
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
