import { createHighlighter, type Highlighter, type ThemedToken } from "shiki";
import { resolveDiffLanguage } from "./prosemirror/diff-from-patch";
import type { DiffDisplayLine } from "./diff-display-lines";

/** Codex-like caps: skip rich highlight on huge diffs to avoid main-thread stalls. */
const MAX_HIGHLIGHT_LINES = 2_000;
const MAX_HIGHLIGHT_CHARS = 400_000;

const BUNDLED_LANGS = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "css",
  "html",
  "markdown",
  "python",
  "rust",
  "go",
  "java",
  "shellscript",
  "yaml",
  "toml",
  "sql",
  "ruby",
  "c",
  "cpp",
  "xml",
  "diff",
  "plaintext",
] as const;

const SHIKI_ALIAS: Readonly<Record<string, string>> = {
  shell: "shellscript",
  bash: "shellscript",
  sh: "shellscript",
  zsh: "shellscript",
  ts: "typescript",
  js: "javascript",
  md: "markdown",
  mdx: "markdown",
  yml: "yaml",
  htm: "html",
  cjs: "javascript",
  mjs: "javascript",
  rs: "rust",
  py: "python",
  rb: "ruby",
};

export function resolveShikiLanguage(path: string): string {
  const fromPath = resolveDiffLanguage(path);
  if (!fromPath) return "plaintext";
  return SHIKI_ALIAS[fromPath] ?? fromPath;
}

function themeForApp(theme: "light" | "dark"): "github-light" | "github-dark" {
  return theme === "dark" ? "github-dark" : "github-light";
}

let highlighterPromise: Promise<Highlighter> | null = null;

export function getDiffHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [...BUNDLED_LANGS],
    });
  }
  return highlighterPromise;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function themedTokensToHtml(tokens: ThemedToken[]): string {
  if (tokens.length === 0) return "\u00a0";
  return tokens
    .map((token) => {
      const color = token.color ? `color:${token.color}` : "";
      const fontStyle =
        token.fontStyle && token.fontStyle > 0
          ? [
              token.fontStyle & 1 ? "font-style:italic" : "",
              token.fontStyle & 2 ? "font-weight:bold" : "",
              token.fontStyle & 4 ? "text-decoration:underline" : "",
            ]
              .filter(Boolean)
              .join(";")
          : "";
      const style = [color, fontStyle].filter(Boolean).join(";");
      const content = escapeHtml(token.content);
      if (!style) return content || "";
      return `<span style="${style}">${content}</span>`;
    })
    .join("") || "\u00a0";
}

async function resolveLoadedLanguage(highlighter: Highlighter, lang: string): Promise<string> {
  const loaded = highlighter.getLoadedLanguages();
  if (loaded.includes(lang)) return lang;
  try {
    await highlighter.loadLanguage(lang as never);
    return lang;
  } catch {
    return "plaintext";
  }
}

function tokenLinesFromCode(
  highlighter: Highlighter,
  code: string,
  lang: string,
  theme: "github-light" | "github-dark",
): ThemedToken[][] {
  if (!code) return [];
  const result = highlighter.codeToTokens(code, { lang: lang as never, theme });
  return result.tokens;
}

/**
 * Highlight structured diff display lines like Codex:
 * tokenize deletion+context as the old side, insert+context as the new side,
 * then map tokenized lines back to the interleaved patch display.
 */
export async function highlightDiffDisplayLines(
  lines: DiffDisplayLine[],
  language: string,
  appTheme: "light" | "dark",
): Promise<(string | null)[]> {
  const htmls: (string | null)[] = lines.map(() => null);
  if (lines.length === 0) return htmls;

  const totalChars = lines.reduce((sum, line) => sum + line.text.length + 1, 0);
  if (lines.length > MAX_HIGHLIGHT_LINES || totalChars > MAX_HIGHLIGHT_CHARS) {
    return htmls;
  }

  const oldTexts: string[] = [];
  const oldToDisplay: number[] = [];
  const newTexts: string[] = [];
  const newToDisplay: number[] = [];

  lines.forEach((line, index) => {
    if (line.kind === "delete" || line.kind === "context") {
      oldTexts.push(line.text);
      oldToDisplay.push(index);
    }
    if (line.kind === "insert" || line.kind === "context") {
      newTexts.push(line.text);
      newToDisplay.push(index);
    }
  });

  try {
    const highlighter = await getDiffHighlighter();
    const lang = await resolveLoadedLanguage(highlighter, language);
    const theme = themeForApp(appTheme);

    const oldTokenLines = tokenLinesFromCode(highlighter, oldTexts.join("\n"), lang, theme);
    const newTokenLines = tokenLinesFromCode(highlighter, newTexts.join("\n"), lang, theme);

    oldTokenLines.forEach((tokens, i) => {
      const displayIndex = oldToDisplay[i];
      if (displayIndex === undefined) return;
      const line = lines[displayIndex];
      if (!line) return;
      if (line.kind === "delete") {
        htmls[displayIndex] = themedTokensToHtml(tokens);
      } else if (line.kind === "context") {
        htmls[displayIndex] = themedTokensToHtml(tokens);
      }
    });

    newTokenLines.forEach((tokens, i) => {
      const displayIndex = newToDisplay[i];
      if (displayIndex === undefined) return;
      const line = lines[displayIndex];
      if (!line) return;
      if (line.kind === "insert" || line.kind === "context") {
        htmls[displayIndex] = themedTokensToHtml(tokens);
      }
    });
  } catch {
    // Keep plain text on highlighter failure — do not fake success.
  }

  return htmls;
}
