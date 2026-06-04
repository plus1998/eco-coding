import type { SkillInfo } from "../shared/skills";

const SKILL_TOKEN_PATTERN = /\$([a-zA-Z0-9][a-zA-Z0-9_-]*)/g;

export type ComposerPromptSegment =
  | { type: "text"; value: string }
  | { type: "skill"; name: string };

export function parseComposerPromptSegments(text: string): ComposerPromptSegment[] {
  if (!text) {
    return [];
  }
  const segments: ComposerPromptSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(SKILL_TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, index) });
    }
    segments.push({ type: "skill", name: match[1]! });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }
  return segments;
}

export function formatSkillChipLabel(tokenName: string, skill?: SkillInfo): string {
  const raw = skill?.name?.trim() || tokenName;
  if (/[\s]/.test(raw) || /[A-Z]/.test(raw)) {
    return raw;
  }
  return raw.replace(/-/g, " ");
}

export function skillTokenForName(name: string): string {
  return `$${name}`;
}
