import type { SkillInfo } from "../shared/skills";

export interface SkillFuzzyMatch {
  skill: SkillInfo;
  /** Inclusive start, exclusive end indices in skill.name for bold highlight. */
  ranges: Array<{ start: number; end: number }>;
  score: number;
}

export function filterUserSkills(query: string, userSkills: readonly SkillInfo[]): SkillFuzzyMatch[] {
  const normalized = query.trim().toLowerCase();
  const matches: SkillFuzzyMatch[] = [];

  for (const skill of userSkills) {
    const result = scoreFuzzyMatch(normalized, skill.name, skill.description);
    if (!result) {
      continue;
    }
    matches.push({ skill, ranges: result.ranges, score: result.score });
  }

  return matches.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
}

function scoreFuzzyMatch(
  query: string,
  name: string,
  description: string,
): { score: number; ranges: Array<{ start: number; end: number }> } | null {
  if (!query) {
    return { score: 0, ranges: [] };
  }

  const nameLower = name.toLowerCase();
  const nameMatch = findSubsequenceRanges(query, nameLower);
  if (nameMatch) {
    const bonus = nameLower.startsWith(query) ? 80 : nameLower.includes(query) ? 40 : 0;
    return { score: 100 + bonus + nameMatch.consecutiveBonus, ranges: nameMatch.ranges };
  }

  const descLower = description.toLowerCase();
  if (findSubsequence(query, descLower)) {
    return { score: 30, ranges: [] };
  }

  return null;
}

function findSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const char of needle) {
    index = haystack.indexOf(char, index);
    if (index === -1) {
      return false;
    }
    index += 1;
  }
  return true;
}

function findSubsequenceRanges(
  needle: string,
  haystack: string,
): { ranges: Array<{ start: number; end: number }>; consecutiveBonus: number } | null {
  const indices: number[] = [];
  let searchFrom = 0;
  for (const char of needle) {
    const index = haystack.indexOf(char, searchFrom);
    if (index === -1) {
      return null;
    }
    indices.push(index);
    searchFrom = index + 1;
  }

  const ranges: Array<{ start: number; end: number }> = [];
  let runStart = indices[0]!;
  let runEnd = indices[0]! + 1;
  let consecutiveBonus = 0;

  for (let i = 1; i < indices.length; i += 1) {
    const current = indices[i]!;
    if (current === runEnd) {
      runEnd = current + 1;
      consecutiveBonus += 8;
      continue;
    }
    ranges.push({ start: runStart, end: runEnd });
    runStart = current;
    runEnd = current + 1;
  }
  ranges.push({ start: runStart, end: runEnd });

  return { ranges, consecutiveBonus };
}

export function highlightSkillName(
  name: string,
  ranges: Array<{ start: number; end: number }>,
): Array<{ text: string; match: boolean }> {
  if (ranges.length === 0) {
    return [{ text: name, match: false }];
  }

  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      parts.push({ text: name.slice(cursor, range.start), match: false });
    }
    parts.push({ text: name.slice(range.start, range.end), match: true });
    cursor = range.end;
  }
  if (cursor < name.length) {
    parts.push({ text: name.slice(cursor), match: false });
  }
  return parts;
}
