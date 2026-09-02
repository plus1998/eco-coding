/** Copy plain text to the system clipboard from a renderer. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to execCommand when permission/API rejects.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Prefer HTML+plain ClipboardItem; plain mirrors HTML for text-only paste targets. */
export async function copyHtmlToClipboard(html: string, plainText: string = html): Promise<boolean> {
  if (!html.trim()) {
    return false;
  }
  const plain = plainText.trim() ? plainText : html;
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
  } catch {
    // Fall through.
  }
  // Last resort: still prefer HTML source over an unrelated format.
  return copyTextToClipboard(plain);
}

/** Write a PNG blob to the clipboard. */
export async function copyPngBlobToClipboard(blob: Blob): Promise<boolean> {
  if (blob.size < 1) return false;
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      // Some Chromium builds want a Promise<Blob> for image MIME types.
      const item = new ClipboardItem({
        "image/png": Promise.resolve(blob),
      });
      await navigator.clipboard.write([item]);
      return true;
    }
  } catch {
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "image/png": blob,
          }),
        ]);
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}
