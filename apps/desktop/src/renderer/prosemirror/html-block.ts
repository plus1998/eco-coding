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
