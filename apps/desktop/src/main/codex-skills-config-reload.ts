import { normalizeSkillsEnabled, type SkillsEnabledSettings } from "../shared/composer-skills-settings";

/** Shown when Skills would change on a loaded Codex thread (upstream reload defect). */
export const CODEX_SKILLS_CONFIG_RELOAD_BLOCKED_MESSAGE =
  "无法修改 Skills：当前 Codex 会话已在 app-server 中加载，配置重载依赖冷重启；有会话运行或共享进程下不能冷重启（Codex 0.150+ 仍未修复：loaded idle 下 thread/resume(config) 可能静默忽略）。请保持现有 Skills 继续对话，或新建会话后再调整。";

export type CodexSkillsReloadThreadStatus = "notLoaded" | "idle" | "systemError" | "active" | "unknown";

export function skillsEnabledSettingsChanged(
  existing: SkillsEnabledSettings | undefined,
  next: SkillsEnabledSettings | undefined,
): boolean {
  return fingerprintSkillsEnabled(existing) !== fingerprintSkillsEnabled(next);
}

function fingerprintSkillsEnabled(value: SkillsEnabledSettings | undefined): string {
  const normalized = normalizeSkillsEnabled(value);
  if (!normalized) {
    return "";
  }
  return JSON.stringify(
    Object.keys(normalized)
      .sort()
      .map((key) => [key, normalized[key] === true]),
  );
}

/**
 * Block Skills persistence when a mapped Codex thread is still loaded on app-server.
 * Status undefined = client not running (next start applies config) → allow.
 */
export function shouldBlockCodexSkillsConfigReload(input: {
  skillsChanged: boolean;
  hasCodexMapping: boolean;
  status: CodexSkillsReloadThreadStatus | undefined;
}): boolean {
  if (!input.skillsChanged || !input.hasCodexMapping) {
    return false;
  }
  if (input.status === undefined || input.status === "notLoaded") {
    return false;
  }
  return true;
}
