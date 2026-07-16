import type { SkillInfo } from "./skills";

export type SkillsEnabledSettings = Record<string, boolean>;

export interface ProjectSkillsSettingsSnapshot {
  workspacePath: string;
  enabledByPath: SkillsEnabledSettings;
}

export function deriveSkillsEnabled(
  skills: readonly SkillInfo[],
  options: {
    existing?: Partial<SkillsEnabledSettings>;
    remembered?: Partial<SkillsEnabledSettings>;
  } = {},
): SkillsEnabledSettings {
  const skillKeys = skills.map((skill) => skill.settingsKey ?? skill.skillFilePath);
  const existingEntries = Object.entries(options.existing ?? {});
  if (
    options.existing !== undefined &&
    existingEntries.length === skillKeys.length &&
    skillKeys.every((key) => typeof options.existing?.[key] === "boolean")
  ) {
    return options.existing as SkillsEnabledSettings;
  }

  const result: SkillsEnabledSettings = {};
  for (const [index, skill] of skills.entries()) {
    const key = skillKeys[index] ?? skill.skillFilePath;
    if (typeof options.existing?.[key] === "boolean") {
      result[key] = options.existing[key];
    } else if (typeof options.remembered?.[key] === "boolean") {
      result[key] = options.remembered[key];
    } else {
      result[key] = skill.source === "project";
    }
  }
  return result;
}

export function normalizeSkillsEnabled(value: unknown): SkillsEnabledSettings | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: SkillsEnabledSettings = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (key.trim() && typeof enabled === "boolean") result[key] = enabled;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
