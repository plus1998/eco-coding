import {
  SKILL_NAME_TOKEN,
  type SkillInfo,
  parseExplicitSkillNames,
  promptIncludesSkillName,
} from "../shared/skills";
import { filterUserSkills, type SkillFuzzyMatch } from "./skill-fuzzy";

export { parseExplicitSkillNames, promptIncludesSkillName };

export type PromptSegment = { type: "text"; value: string } | { type: "skill"; name: string };

export type SlashQuery = { start: number; query: string };

export function skillToken(name: string): string {
  return `$${name}`;
}

/** Display label for kebab-case skill ids (Codex-style: vue-router → Vue Router). */
export function formatSkillDisplayName(tokenName: string, skill?: SkillInfo): string {
  const raw = skill?.name ?? tokenName;
  if (!/[-_]/.test(raw)) {
    return raw;
  }
  return raw
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function buildSkillMap(skills: readonly SkillInfo[]): Map<string, SkillInfo> {
  return new Map(skills.map((skill) => [skill.name, skill]));
}

export function parsePromptSegments(text: string): PromptSegment[] {
  if (!text) {
    return [];
  }
  const segments: PromptSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(SKILL_NAME_TOKEN)) {
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

export function promptHasSkillTokens(text: string): boolean {
  return parseExplicitSkillNames(text).length > 0;
}

export function parseSlashQuery(text: string, cursor: number): SlashQuery | null {
  const clamped = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, clamped);
  const match = before.match(/(?:^|\s)(\/[^\s/]*)$/);
  if (!match?.[1]) {
    return null;
  }
  const token = match[1];
  return { start: before.length - token.length, query: token.slice(1) };
}

export function applySlashSkillSelection(
  text: string,
  selection: { start: number; end: number },
  skillName: string,
): { next: string; cursor: number } {
  const replacement = `${skillToken(skillName)} `;
  const next = `${text.slice(0, selection.start)}${replacement}${text.slice(selection.end)}`;
  return { next, cursor: selection.start + replacement.length };
}

export function filterSkillsForSlash(
  query: string,
  skills: readonly SkillInfo[],
  referenced: ReadonlySet<string>,
): SkillFuzzyMatch[] {
  const available = skills.filter((skill) => !referenced.has(skill.name));
  return filterUserSkills(query, available);
}
