import path from "node:path";
import type { SkillsEnabledSettings } from "../shared/composer-skills-settings";
import { isSkillAvailableForCore, type SkillInfo } from "../shared/skills";
import { skillsEnabledSettingsChanged } from "./codex-skills-config-reload";
import { listDiscoveredSkills } from "./skills-discovery";

export type PiThreadSkillEntry = {
  skill: SkillInfo;
  enabled: boolean;
};

/**
 * Resolve Eco-discovered skills for a PI thread (agents + .pi layouts).
 * Project skills default ON; user skills default OFF — same as Claude/Codex.
 */
export async function resolvePiThreadSkills(input: {
  workspacePath: string;
  skillsEnabled?: SkillsEnabledSettings;
}): Promise<PiThreadSkillEntry[]> {
  const discovered = await listDiscoveredSkills(input.workspacePath);
  const settings = input.skillsEnabled;
  return [...discovered.userSkills, ...discovered.projectSkills]
    .filter((skill) => isSkillAvailableForCore(skill, "pi"))
    .map((skill) => ({
      skill,
      enabled: settings?.[skill.settingsKey ?? skill.skillFilePath] ?? skill.source === "project",
    }));
}

/** Absolute directories passed to PI ResourceLoader for this thread. */
export function piSkillDirectoriesForSession(entries: readonly PiThreadSkillEntry[]): string[] {
  return [
    ...new Set(entries.filter((entry) => entry.enabled).map((entry) => path.resolve(entry.skill.directory))),
  ].sort((a, b) => a.localeCompare(b));
}

/**
 * PI can hot-reload skills via AgentSession.reload (unlike Codex app-server).
 * Never block Skills toggles on idle PI sessions — only the global "running" gate applies.
 */
export function shouldBlockPiSkillsConfigReload(input: {
  skillsChanged: boolean;
  threadStatus: string | undefined;
}): boolean {
  if (!input.skillsChanged) {
    return false;
  }
  // Running/queued already blocked by thread runtime config update; keep explicit for clarity.
  return input.threadStatus === "running" || input.threadStatus === "queued";
}

export { skillsEnabledSettingsChanged };
