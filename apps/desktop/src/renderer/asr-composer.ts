export function mergeAsrTextAtSelection(
  prompt: string,
  text: string,
  selectionStart: number,
  selectionEnd: number,
): { prompt: string; cursor: number } {
  // Empty composer often holds only a contenteditable <br> serialized as "\n".
  const base = prompt.trim() === "" ? "" : prompt;
  const insertion = text.replace(/^\s+/, "");
  const start = Math.max(0, Math.min(selectionStart, base.length));
  const end = Math.max(start, Math.min(selectionEnd, base.length));
  const effectiveStart = prompt.trim() === "" ? 0 : start;
  const effectiveEnd = prompt.trim() === "" ? 0 : end;
  return {
    prompt: `${base.slice(0, effectiveStart)}${insertion}${base.slice(effectiveEnd)}`,
    cursor: effectiveStart + insertion.length,
  };
}
