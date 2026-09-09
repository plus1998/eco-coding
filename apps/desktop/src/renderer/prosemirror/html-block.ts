import type MarkdownIt from "markdown-it";

/** Minimal markdown-it token shape used by HTML container stitching. */
export interface HtmlStitchToken {
  type: string;
  content: string;
  map?: [number, number] | null;
}

export function isHtmlLang(params: unknown): boolean {
  const raw = String(params ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return false;
  const first = raw.split(/\s+/)[0] ?? "";
  return first === "html" || first === "htm";
}

export function extractHtmlDocumentTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = match?.[1]?.trim();
  return title || undefined;
}

export function countHtmlLines(html: string): number {
  if (!html) return 0;
  return html.split(/\r?\n/u).length;
}

/**
 * CommonMark / markdown-it 会在空行处切断 type-6 HTML block。
 * GitHub 对 details/div/table 等容器更接近「找到闭合标签再结束」。
 * 这里把被拆开的开标签、中间 Markdown、闭标签缝回一个 html_block，
 * 中间段先渲染成 HTML，效果接近 GFM（details 内可继续有段落等）。
 */
const HTML_CONTAINER_TAGS = new Set([
  "aside",
  "article",
  "details",
  "div",
  "dl",
  "fieldset",
  "figure",
  "footer",
  "form",
  "header",
  "main",
  "nav",
  "section",
  "table",
]);

export function openHtmlContainerTag(html: string): string | null {
  const match = html.match(/^\s*<([A-Za-z][\w-]*)\b[^>]*>/);
  if (!match?.[1]) return null;
  const tag = match[1].toLowerCase();
  if (!HTML_CONTAINER_TAGS.has(tag)) return null;
  if (new RegExp(`</${tag}\\s*>`, "i").test(html)) return null;
  if (/\/>\s*$/.test(html.trim())) return null;
  return tag;
}

export function isHtmlContainerClose(html: string, tag: string): boolean {
  return new RegExp(`^\\s*</${tag}\\s*>`, "i").test(html);
}

export function stitchHtmlContainerTokens<T extends HtmlStitchToken>(
  tokens: T[],
  md: MarkdownIt,
  env: unknown = {},
): T[] {
  const out = tokens.slice();
  let i = 0;
  while (i < out.length) {
    const token = out[i];
    if (!token || token.type !== "html_block") {
      i += 1;
      continue;
    }
    const tag = openHtmlContainerTag(token.content);
    if (!tag) {
      i += 1;
      continue;
    }

    let depth = 1;
    let found = -1;
    for (let j = i + 1; j < out.length; j += 1) {
      const candidate = out[j];
      if (!candidate || candidate.type !== "html_block") continue;
      if (openHtmlContainerTag(candidate.content) === tag) {
        depth += 1;
        continue;
      }
      if (!isHtmlContainerClose(candidate.content, tag)) continue;
      depth -= 1;
      if (depth === 0) {
        found = j;
        break;
      }
    }

    if (found < 0) {
      i += 1;
      continue;
    }

    const middle = out.slice(i + 1, found);
    const middleHtml = middle.length > 0 ? md.renderer.render(middle, md.options, env) : "";
    const close = out[found];
    token.content = `${token.content}${middleHtml}${close?.content ?? ""}`;
    if (token.map && close?.map) {
      token.map = [token.map[0], close.map[1]];
    }
    out.splice(i + 1, found - i);
    i += 1;
  }
  return out;
}

export function installHtmlContainerStitch(md: MarkdownIt): void {
  md.core.ruler.after("inline", "eco_stitch_html_containers", (state) => {
    state.tokens = stitchHtmlContainerTokens(state.tokens, md, state.env);
  });
}

export function htmlBlockToDOM(html: string): HTMLElement | [string, Record<string, string>] {
  const raw = String(html ?? "");
  if (typeof document === "undefined") {
    return ["div", { class: "markdown-html-block" }];
  }
  const wrapper = document.createElement("div");
  wrapper.className = "markdown-html-block";
  wrapper.innerHTML = raw;
  return wrapper;
}

export function htmlInlineToDOM(html: string): HTMLElement | [string, Record<string, string>] {
  const raw = String(html ?? "");
  if (typeof document === "undefined") {
    return ["span", { class: "markdown-html-inline" }];
  }
  const wrapper = document.createElement("span");
  wrapper.className = "markdown-html-inline";
  wrapper.innerHTML = raw;
  return wrapper;
}
