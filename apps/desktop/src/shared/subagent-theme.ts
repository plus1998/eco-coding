export const SUBAGENT_DEFAULT_THEME_COLORS: Readonly<Record<string, string>> = {
  explore: "#A78BFA",
  architect: "#22D3EE",
  coder: "#34D399",
  reviewer: "#FBBF24",
  tester: "#F472B6",
};

export const SUBAGENT_UNKNOWN_THEME_COLOR = "#60A5FA";

export const SUBAGENT_PRESET_THEME_COLORS: readonly string[] = [
  SUBAGENT_DEFAULT_THEME_COLORS.explore,
  SUBAGENT_DEFAULT_THEME_COLORS.architect,
  SUBAGENT_DEFAULT_THEME_COLORS.coder,
  SUBAGENT_DEFAULT_THEME_COLORS.reviewer,
  SUBAGENT_DEFAULT_THEME_COLORS.tester,
  SUBAGENT_UNKNOWN_THEME_COLOR,
];

const THEME_HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export function stripEcoAgentKeyPrefix(value: string): string {
  return value.startsWith("eco_") ? value.slice(4) : value;
}

export function defaultThemeColorForAgentKey(agentKey: string): string {
  const normalized = stripEcoAgentKeyPrefix(agentKey.trim().toLowerCase());
  return SUBAGENT_DEFAULT_THEME_COLORS[normalized] ?? SUBAGENT_UNKNOWN_THEME_COLOR;
}

export function isValidThemeColorHex(value: string): boolean {
  return THEME_HEX_PATTERN.test(value.trim());
}

export function normalizeThemeColorHex(value: string): string {
  const trimmed = value.trim();
  if (!isValidThemeColorHex(trimmed)) {
    throw new Error(`无效主题色：${value}。请使用 #RRGGBB 格式。`);
  }
  return trimmed.toUpperCase();
}

export function parseThemeColorHex(value: string): string {
  return normalizeThemeColorHex(value);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

export function subagentThemeCssVars(color: string): Record<string, string> {
  const { r, g, b } = hexToRgb(color);
  return {
    "--subagent-accent": color,
    "--subagent-accent-soft": `rgba(${r}, ${g}, ${b}, 0.07)`,
    "--subagent-accent-border": `rgba(${r}, ${g}, ${b}, 0.28)`,
  };
}

export function subagentThemeBorderColor(color: string): string {
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, 0.28)`;
}
