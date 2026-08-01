export function mergeAsrTextAtSelection(
  prompt: string,
  text: string,
  selectionStart: number,
  selectionEnd: number,
): { prompt: string; cursor: number } {
  const start = Math.max(0, Math.min(selectionStart, prompt.length));
  const end = Math.max(start, Math.min(selectionEnd, prompt.length));
  return {
    prompt: `${prompt.slice(0, start)}${text}${prompt.slice(end)}`,
    cursor: start + text.length,
  };
}
