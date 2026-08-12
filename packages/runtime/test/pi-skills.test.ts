import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ensurePiPrivateSkillsDir,
  fingerprintPiSkillPaths,
  mountSkillIntoPiPrivateDir,
  resolvePiPrivateSkillsDir,
  resolvePiSessionSkillPaths,
} from "../src/pi-skills";

test("fingerprintPiSkillPaths is order-independent and path-normalized", () => {
  const a = fingerprintPiSkillPaths(["/tmp/b", "/tmp/a"]);
  const b = fingerprintPiSkillPaths(["/tmp/a", "/tmp/b/", "/tmp/a"]);
  expect(a).toBe(b);
  expect(fingerprintPiSkillPaths(undefined)).toBe("");
  expect(fingerprintPiSkillPaths([])).toBe("");
});

test("resolvePiSessionSkillPaths always includes private agentDir/skills", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eco-pi-skills-"));
  try {
    const agentDir = path.join(root, "agent");
    const paths = resolvePiSessionSkillPaths({
      agentDir,
      skillPaths: [path.join(root, "shared-skill")],
    });
    expect(paths).toContain(path.resolve(root, "shared-skill"));
    expect(paths).toContain(resolvePiPrivateSkillsDir(agentDir));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("ensurePiPrivateSkillsDir and mountSkillIntoPiPrivateDir isolate under agentDir", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eco-pi-mount-"));
  try {
    const agentDir = path.join(root, "pi-agent", "thread-1");
    const source = path.join(root, "source-skill");
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(
      path.join(source, "SKILL.md"),
      `---\nname: demo-skill\ndescription: Demo skill for private mount.\n---\n\n# Demo\n`,
    );
    const privateDir = await ensurePiPrivateSkillsDir(agentDir);
    expect(privateDir).toBe(resolvePiPrivateSkillsDir(agentDir));
    const mounted = await mountSkillIntoPiPrivateDir({
      agentDir,
      skillDirectory: source,
      skillName: "demo-skill",
    });
    expect(mounted.startsWith(privateDir)).toBe(true);
    await fs.access(path.join(mounted, "SKILL.md"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
