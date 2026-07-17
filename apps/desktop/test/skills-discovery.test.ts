import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listDiscoveredSkills } from "../src/main/skills-discovery";
import { dedupeSkillsByName, listSdkReadyProjectSkills } from "../src/shared/skills";

async function writeSkill(dir: string, name: string, skillName: string) {
  const root = path.join(dir, name);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, "SKILL.md"),
    `---
name: ${skillName}
description: Test skill ${skillName}
---
`,
  );
}

test("discovers project skill under .agents/skills", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eco-skills-"));
  try {
    await writeSkill(path.join(tmp, ".agents", "skills"), "foo", "foo");
    const result = await listDiscoveredSkills(tmp);
    const agents = result.projectSkills.find((s) => s.name === "foo");
    expect(agents).toBeDefined();
    expect(agents?.layout).toBe("agents");
    expect(agents?.sdkReady).toBe(false);
    expect(result.agentsOnlySkills.some((s) => s.name === "foo")).toBe(true);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("discovers project skill under .codex/skills", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eco-skills-"));
  try {
    await writeSkill(path.join(tmp, ".codex", "skills"), "codex-project", "codex-project");
    const result = await listDiscoveredSkills(tmp);
    const skill = result.projectSkills.find((candidate) => candidate.name === "codex-project");
    expect(skill?.layout).toBe("codex");
    expect(skill?.sdkReady).toBe(false);
    expect(result.agentsOnlySkills.some((candidate) => candidate.name === "codex-project")).toBe(false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("agents skill becomes sdkReady after symlink to .claude/skills", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eco-skills-"));
  try {
    await writeSkill(path.join(tmp, ".agents", "skills"), "bar", "bar");
    const claudeSkills = path.join(tmp, ".claude", "skills");
    await fs.mkdir(claudeSkills, { recursive: true });
    await fs.symlink(path.join("..", "..", ".agents", "skills", "bar"), path.join(claudeSkills, "bar"));

    const result = await listDiscoveredSkills(tmp);
    const agents = result.projectSkills.find((s) => s.name === "bar" && s.layout === "agents");
    expect(agents?.sdkReady).toBe(true);
    expect(result.agentsOnlySkills.some((s) => s.name === "bar")).toBe(false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("same skill name in .claude and .agents loads once and skips agents-only hint", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eco-skills-"));
  try {
    await writeSkill(path.join(tmp, ".claude", "skills"), "dup", "dup");
    await writeSkill(path.join(tmp, ".agents", "skills"), "dup", "dup");
    const result = await listDiscoveredSkills(tmp);
    expect(listSdkReadyProjectSkills(result.projectSkills).filter((s) => s.name === "dup")).toHaveLength(
      1,
    );
    expect(result.agentsOnlySkills.some((s) => s.name === "dup")).toBe(false);
    expect(dedupeSkillsByName(result.projectSkills).filter((s) => s.name === "dup")).toHaveLength(1);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("discovers both .claude and .agents layouts in one repo", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eco-skills-"));
  try {
    await writeSkill(path.join(tmp, ".claude", "skills"), "claude-skill", "claude-skill");
    await writeSkill(path.join(tmp, ".agents", "skills"), "agents-skill", "agents-skill");
    const result = await listDiscoveredSkills(tmp);
    expect(result.projectSkills.some((s) => s.name === "claude-skill" && s.sdkReady)).toBe(true);
    expect(result.projectSkills.some((s) => s.name === "agents-skill" && s.layout === "agents")).toBe(
      true,
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("discovers Claude, Agents, and Codex user skill roots", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eco-user-skills-"));
  try {
    await writeSkill(path.join(tmp, ".claude", "skills"), "claude-skill", "claude-skill");
    await writeSkill(path.join(tmp, ".agents", "skills"), "agents-skill", "agents-skill");
    await writeSkill(path.join(tmp, ".codex", "skills"), "codex-skill", "codex-skill");
    await writeSkill(
      path.join(tmp, ".codex", "skills", ".system"),
      "system-skill",
      "system-skill",
    );

    const result = await listDiscoveredSkills(undefined, { homedir: tmp });

    expect(result.userSkills.map((skill) => [skill.name, skill.layout, skill.sdkReady])).toEqual([
      ["claude-skill", "claude", true],
      ["agents-skill", "agents", false],
      ["codex-skill", "codex", false],
      ["system-skill", "codex", false],
    ]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("discovers catalog identity from the compatible global Skill lock", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eco-user-skills-"));
  try {
    await writeSkill(path.join(tmp, ".agents", "skills"), "frontend-design", "frontend-design");
    await fs.writeFile(
      path.join(tmp, ".agents", ".skill-lock.json"),
      JSON.stringify({
        version: 3,
        skills: {
          "frontend-design": { source: "anthropics/skills" },
        },
      }),
    );

    const result = await listDiscoveredSkills(undefined, { homedir: tmp });
    const skill = result.userSkills.find((candidate) => candidate.name === "frontend-design");
    expect(skill?.catalogSource).toBe("anthropics/skills");
    expect(skill?.catalogSkillId).toBe("frontend-design");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
