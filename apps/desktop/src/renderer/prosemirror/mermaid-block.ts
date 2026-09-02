export type MermaidAppTheme = "light" | "dark";

export function isMermaidLang(params: unknown): boolean {
  const raw = String(params ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return false;
  const first = raw.split(/\s+/)[0] ?? "";
  return first === "mermaid";
}

export function readAppTheme(): MermaidAppTheme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;
let initializedTheme: MermaidAppTheme | null = null;
let renderSeq = 0;

const ECO_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "Helvetica Neue", sans-serif';

const ECO_THEME_CSS = `
  .node rect, .node polygon, .node circle, .node ellipse, .actor, .labelBox, .face {
    stroke-width: 1.25px !important;
  }
  .node rect, .labelBox, .actor, .cluster rect, .note, .state-start, .state-end {
    rx: 10px;
    ry: 10px;
  }
  .edgePath .path, .flowchart-link, .messageLine0, .messageLine1 {
    stroke-width: 1.5px !important;
  }
  .marker, .arrowheadPath {
    fill-opacity: 0.9;
  }
  .label foreignObject, .nodeLabel, .edgeLabel, .actor, .messageText, .loopText, .titleText {
    font-family: ${ECO_FONT} !important;
  }
  .edgeLabel rect, .labelBox {
    opacity: 0.96;
  }
`;

/** Fallback palettes aligned with apps/desktop themes.css */
const ECO_PALETTE = {
  dark: {
    background: "transparent",
    primary: "#3b82f6",
    primaryText: "#f5f5f5",
    primaryBorder: "#525252",
    secondary: "#2b2b2b",
    tertiary: "#242424",
    line: "#737373",
    text: "#e8e8e8",
    muted: "#8a8a8a",
    soft: "#303030",
    softBorder: "#404040",
    accentText: "#93c5fd",
    success: "#86efac",
    danger: "#f87171",
    warn: "#fcd34d",
    note: "#262626",
    cluster: "rgba(255,255,255,0.04)",
    edgeLabelBg: "#242424",
  },
  light: {
    background: "transparent",
    primary: "#007aff",
    primaryText: "#1d1d1f",
    primaryBorder: "#d1d1d6",
    secondary: "#f5f5f7",
    tertiary: "#ececee",
    line: "#aeaeb2",
    text: "#2c2c2e",
    muted: "#6e6e73",
    soft: "#f0f0f2",
    softBorder: "#e5e5ea",
    accentText: "#007aff",
    success: "#248a3d",
    danger: "#d70015",
    warn: "#c93400",
    note: "#ffffff",
    cluster: "rgba(0,0,0,0.03)",
    edgeLabelBg: "#ffffff",
  },
} as const;

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function buildEcoMermaidThemeVariables(theme: MermaidAppTheme) {
  const fallback = ECO_PALETTE[theme];
  const primary = cssVar("--accent", fallback.primary);
  const text = cssVar("--markdown-text", fallback.text);
  const heading = cssVar("--markdown-heading", fallback.primaryText);
  const muted = cssVar("--markdown-muted", fallback.muted);
  const border = cssVar("--border-strong", fallback.primaryBorder);
  const elevated = cssVar("--bg-elevated", fallback.secondary);
  const soft = cssVar("--codex-log-chip", fallback.soft);
  const accentText = cssVar("--accent-text", fallback.accentText);
  const success = cssVar("--success", fallback.success);
  const danger = cssVar("--danger", fallback.danger);

  return {
    darkMode: theme === "dark",
    background: "transparent",
    fontFamily: ECO_FONT,
    fontSize: "13px",
    primaryColor: soft,
    primaryTextColor: heading,
    primaryBorderColor: border,
    secondaryColor: elevated,
    secondaryTextColor: text,
    secondaryBorderColor: border,
    tertiaryColor: fallback.tertiary,
    tertiaryTextColor: muted,
    tertiaryBorderColor: border,
    lineColor: fallback.line,
    textColor: text,
    mainBkg: soft,
    nodeBkg: soft,
    nodeBorder: border,
    clusterBkg: fallback.cluster,
    clusterBorder: border,
    titleColor: heading,
    edgeLabelBackground: fallback.edgeLabelBg,
    actorBkg: soft,
    actorBorder: border,
    actorTextColor: heading,
    actorLineColor: fallback.line,
    signalColor: fallback.line,
    signalTextColor: text,
    labelBoxBkgColor: soft,
    labelBoxBorderColor: border,
    labelTextColor: heading,
    loopTextColor: muted,
    noteBkgColor: fallback.note,
    noteTextColor: text,
    noteBorderColor: border,
    activationBkgColor: cssVar(
      "--accent-soft",
      theme === "dark" ? "rgba(59,130,246,0.18)" : "rgba(0,122,255,0.12)",
    ),
    activationBorderColor: primary,
    sequenceNumberColor: heading,
    sectionBkgColor: elevated,
    altSectionBkgColor: soft,
    sectionBkgColor2: fallback.tertiary,
    taskBkgColor: soft,
    taskBorderColor: border,
    taskTextColor: text,
    taskTextDarkColor: text,
    taskTextLightColor: heading,
    taskTextOutsideColor: text,
    activeTaskBkgColor: cssVar(
      "--accent-soft",
      theme === "dark" ? "rgba(59,130,246,0.2)" : "rgba(0,122,255,0.14)",
    ),
    activeTaskBorderColor: primary,
    gridColor: border,
    doneTaskBkgColor: theme === "dark" ? "rgba(134,239,172,0.16)" : "rgba(36,138,61,0.12)",
    doneTaskBorderColor: success,
    critBkgColor: theme === "dark" ? "rgba(248,113,113,0.16)" : "rgba(215,0,21,0.1)",
    critBorderColor: danger,
    todayLineColor: primary,
    cScale0: primary,
    cScale1: accentText,
    cScale2: success,
    cScale3: fallback.warn,
    cScale4: danger,
    cScale5: muted,
    pie1: primary,
    pie2: accentText,
    pie3: success,
    pie4: fallback.warn,
    pie5: danger,
    pie6: muted,
    pie7: border,
    pie8: elevated,
    pie9: soft,
    pie10: text,
    pie11: fallback.line,
    pie12: heading,
    pieTitleTextSize: "14px",
    pieTitleTextColor: heading,
    pieSectionTextColor: heading,
    pieLegendTextColor: text,
    pieStrokeColor: theme === "dark" ? "#171717" : "#ffffff",
    pieStrokeWidth: "1px",
    pieOuterStrokeColor: "transparent",
    pieOpacity: "0.95",
  };
}

export function buildEcoMermaidConfig(theme: MermaidAppTheme): Record<string, unknown> {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: buildEcoMermaidThemeVariables(theme),
    themeCSS: ECO_THEME_CSS,
    fontFamily: ECO_FONT,
    flowchart: {
      curve: "basis",
      padding: 14,
      nodeSpacing: 36,
      rankSpacing: 44,
      htmlLabels: true,
      useMaxWidth: true,
    },
    sequence: {
      actorMargin: 28,
      messageMargin: 36,
      mirrorActors: false,
      useMaxWidth: true,
      boxMargin: 10,
      noteMargin: 10,
    },
    gantt: {
      useMaxWidth: true,
      barHeight: 22,
      barGap: 6,
      topPadding: 40,
      fontSize: 12,
    },
    pie: {
      useMaxWidth: true,
      textPosition: 0.75,
    },
  };
}

async function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const api = (mod.default ?? mod) as MermaidApi;
      return api;
    });
  }
  return mermaidPromise;
}

export async function ensureMermaid(theme: MermaidAppTheme): Promise<MermaidApi> {
  const mermaid = await loadMermaid();
  if (initializedTheme !== theme) {
    mermaid.initialize(buildEcoMermaidConfig(theme));
    initializedTheme = theme;
  }
  return mermaid;
}

export function nextMermaidRenderId(): string {
  renderSeq += 1;
  return `eco-mermaid-${renderSeq}-${Date.now()}`;
}

/** Mermaid leaves `#d{id}` / `#i{id}` on `document.body` when render throws before cleanup. */
export function cleanupMermaidRenderArtifacts(renderId: string): void {
  if (typeof document === "undefined") return;
  for (const id of [renderId, `d${renderId}`, `i${renderId}`]) {
    document.getElementById(id)?.remove();
  }
}

/** Remove leaked temp nodes from prior failed renders (e.g. after navigating back to landing). */
export function cleanupOrphanedMermaidRenderArtifacts(): void {
  if (typeof document === "undefined") return;
  document.querySelectorAll('[id^="deco-mermaid-"], [id^="ieco-mermaid-"]').forEach((node) => {
    node.remove();
  });
}

export function isMermaidErrorSvg(svg: string): boolean {
  return svg.includes("Syntax error in text") || svg.includes('class="error-text"');
}

export async function renderMermaidSvg(
  source: string,
  theme: MermaidAppTheme = readAppTheme(),
): Promise<string> {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error("Empty Mermaid diagram");
  }
  const mermaid = await ensureMermaid(theme);
  const renderId = nextMermaidRenderId();
  try {
    const { svg } = await mermaid.render(renderId, trimmed);
    if (isMermaidErrorSvg(svg)) {
      throw new Error("Syntax error in text");
    }
    return svg;
  } finally {
    cleanupMermaidRenderArtifacts(renderId);
  }
}

export function observeAppTheme(onChange: (theme: MermaidAppTheme) => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  const root = document.documentElement;
  const update = () => onChange(readAppTheme());
  const observer = new MutationObserver(update);
  observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

if (typeof document !== "undefined") {
  cleanupOrphanedMermaidRenderArtifacts();
}
