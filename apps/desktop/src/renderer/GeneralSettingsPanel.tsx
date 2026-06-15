import { Monitor, Moon, Sun } from "lucide-react";
import type { AppTheme } from "./theme";

interface GeneralSettingsPanelProps {
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
}

const themeOptions: Array<{
  id: AppTheme;
  label: string;
  description: string;
  icon: typeof Sun;
}> = [
  {
    id: "dark",
    label: "深色",
    description: "适合低光环境，减轻眼睛疲劳。",
    icon: Moon,
  },
  {
    id: "light",
    label: "浅色",
    description: "明亮界面，类似 macOS 系统设置。",
    icon: Sun,
  },
];

export function GeneralSettingsPanel({ theme, onThemeChange }: GeneralSettingsPanelProps) {
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
          <Monitor size={18} className="settings-section-head-icon" aria-hidden />
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
