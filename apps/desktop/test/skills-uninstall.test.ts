import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isCodexSystemSkill, uninstallDiscoveredSkill } from "../src/main/skills-uninstall";
import type { SkillInfo } from "../src/shared/skills";

function skill(directory: string, layout: SkillInfo["layout"] = "agents"): SkillInfo {
  return {
    name: path.basename(directory),
    description: "test",
    source: "user",
    directory,
    skillFilePath: path.join(directory, "SKILL.md"),
    layout,
    sdkReady: false,
    baseDir: path.dirname(path.dirname(path.dirname(directory))),
  };
}

test("uninstalls a user Skill directory", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eco-skill-uninstall-"));
  const directory = path.join(tmp, ".agents", "skills", "demo");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "SKILL.md"), "---\nname: demo\n---\n");

  const result = await uninstallDiscoveredSkill(skill(directory));

  expect(result.removed).toBe("directory");
  expect(result.method).toBe("filesystem");
  expect(await fs.exists(directory)).toBe(false);
  await fs.rm(tmp, { recursive: true, force: true });
});

test("uninstalling a linked Skill preserves its target", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eco-skill-uninstall-"));
  const target = path.join(tmp, "shared", "demo");
  const link = path.join(tmp, ".codex", "skills", "demo");
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, "SKILL.md"), "---\nname: demo\n---\n");
  await fs.mkdir(path.dirname(link), { recursive: true });
  await fs.symlink(target, link);

  let cliArgs: string[] = [];
  const result = await uninstallDiscoveredSkill(skill(link, "codex"), {
    runSkillsCli: async (args) => {
      cliArgs = args;
      await fs.unlink(link);
    },
  });

  expect(result.removed).toBe("link");
  expect(result.method).toBe("skills-cli");
  expect(cliArgs).toEqual(["remove", "demo", "--global", "--agent", "codex", "--yes"]);
  expect(await fs.exists(link)).toBe(false);
  expect(await fs.exists(path.join(target, "SKILL.md"))).toBe(true);
  await fs.rm(tmp, { recursive: true, force: true });
});

test("rejects uninstalling Codex system Skills", async () => {
  const info = skill("/Users/test/.codex/skills/.system/imagegen", "codex");
  info.baseDir = "/Users/test";
  expect(isCodexSystemSkill(info)).toBe(true);
  expect(uninstallDiscoveredSkill(info)).rejects.toThrow("system Skills cannot be uninstalled");
});
