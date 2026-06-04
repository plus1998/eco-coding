/** Slash-token `/query` at the text cursor (Composer skill picker). */
export function parseComposerSkillSlashQuery(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const clampedCursor = Math.max(0, Math.min(cursor, text.length));
  const atCursor = parseComposerSkillSlashQueryAt(text, clampedCursor);
  if (atCursor) {
    return atCursor;
  }

  const atEnd = parseComposerSkillSlashQueryAt(text, text.length);
  if (!atEnd) {
    return null;
  }
  if (clampedCursor >= atEnd.start && clampedCursor <= text.length) {
    return atEnd;
  }
  return null;
}

function parseComposerSkillSlashQueryAt(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const match = before.match(/(?:^|\s)(\/[^\s/]*)$/);
  if (!match?.[1]) {
    return null;
  }
  const token = match[1];
  const start = before.length - token.length;
  return { start, query: token.slice(1) };
}

export function applyComposerSkillSelection(
  text: string,
  selection: { start: number; end: number },
  skillName: string,
): { next: string; cursor: number } {
  const replacement = `$${skillName} `;
  const next = `${text.slice(0, selection.start)}${replacement}${text.slice(selection.end)}`;
  const cursor = selection.start + replacement.length;
  return { next, cursor };
}
