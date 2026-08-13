const SKILL_MD_PATTERN = /SKILL\.md$/i;

export function skillNameFromPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  if (!SKILL_MD_PATTERN.test(normalized)) {
    return null;
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  return parts[parts.length - 2] ?? null;
}

export function resolveSkillDisplayName(toolName: string, input: unknown): string | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const record = input as Record<string, unknown>;

  const normalizedTool = toolName.trim().toLowerCase();
  if (normalizedTool === "skill") {
    for (const key of ["skill", "name", "skill_name", "skillName", "skill_id", "skillId", "display_name"] as const) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    const filePath =
      (typeof record.file_path === "string" && record.file_path) ||
      (typeof record.path === "string" && record.path) ||
      (typeof record.skill_path === "string" && record.skill_path) ||
      undefined;
    if (filePath) {
      return skillNameFromPath(filePath);
    }
    return null;
  }

  if (normalizedTool === "read") {
    const filePath =
      (typeof record.file_path === "string" && record.file_path) ||
      (typeof record.path === "string" && record.path) ||
      undefined;
    if (filePath) {
      return skillNameFromPath(filePath);
    }
  }

  return null;
}

export function formatSkillActivityLabel(skillName: string): string {
  return `读取 · ${skillName} 技能`;
}

export function isSkillActivityLabel(label: string): boolean {
  return /^读取 · .+ 技能$/.test(label.trim());
}
