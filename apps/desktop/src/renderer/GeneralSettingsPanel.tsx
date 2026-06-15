import { Laptop, Moon, Sun } from "lucide-react";
import { useMemo } from "react";
import { getRuntimePlatformLabel } from "./runtime-platform";
import type { AppTheme } from "./theme";

interface GeneralSettingsPanelProps {
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
}

export function GeneralSettingsPanel({ theme, onThemeChange }: GeneralSettingsPanelProps) {
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
    </>
  );
}
