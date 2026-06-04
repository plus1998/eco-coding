import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { agentsToClaudeSymlinkTarget, linkAgentsSkillsToClaude } from "../src/main/skills-symlink";
import type { SkillInfo } from "../src/shared/skills";

async function writeAgentsSkill(base: string, name: string) {
  const dir = path.join(base, ".agents", "skills", name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---
name: ${name}
description: Agents skill
---
`,
  );
}

function agentsOnlySkill(baseDir: string, name: string): SkillInfo {
  const directory = path.join(baseDir, ".agents", "skills", name);
  return {
    name,
    description: "Agents skill",
    source: "project",
    directory,
    skillFilePath: path.join(directory, "SKILL.md"),
    layout: "agents",
    sdkReady: false,
    baseDir,
  };
}

test("agentsToClaudeSymlinkTarget uses relative path", () => {
  expect(agentsToClaudeSymlinkTarget("my-skill")).toBe(
    path.join("..", "..", ".agents", "skills", "my-skill"),
  );
});

test("linkAgentsSkillsToClaude creates symlinks", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eco-link-"));
  try {
    await writeAgentsSkill(tmp, "demo");
    const result = await linkAgentsSkillsToClaude([agentsOnlySkill(tmp, "demo")]);
    expect(result.created).toHaveLength(1);
    const linkPath = path.join(tmp, ".claude", "skills", "demo");
    const stat = await fs.lstat(linkPath);
    expect(stat.isSymbolicLink()).toBe(true);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
