import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listDiscoveredCursorAgents } from "../src/main/cursor-agents-discovery";
import {
  mergeCursorAgentsByPrecedence,
  parseCursorAgentFrontmatter,
  resolveCursorAgentName,
  type CursorAgentInfo,
} from "../src/shared/cursor-agents";

test("parseCursorAgentFrontmatter reads scalar and multiline description", () => {
  const parsed = parseCursorAgentFrontmatter(`---
name: verifier
description: |
  Validate completed work.
  Report gaps.
model: inherit
readonly: true
is_background: false
---

You verify work.
`);
  expect(parsed).toEqual({
    name: "verifier",
    description: "Validate completed work.\nReport gaps.",
    model: "inherit",
    readonly: true,
    isBackground: false,
  });
});

test("resolveCursorAgentName falls back to filename stem", () => {
  expect(resolveCursorAgentName("", "/tmp/.cursor/agents/security-reviewer.md")).toBe(
    "security-reviewer",
  );
  expect(resolveCursorAgentName("custom", "/tmp/x.md")).toBe("custom");
});

test("mergeCursorAgentsByPrecedence keeps higher-priority duplicate names", () => {
  const low: CursorAgentInfo = {
    name: "verifier",
    description: "user",
    readonly: false,
    isBackground: false,
    source: "user",
    layout: "codex",
    filePath: "/u/.codex/agents/verifier.md",
  };
  const high: CursorAgentInfo = {
    name: "verifier",
    description: "project cursor",
    readonly: true,
    isBackground: false,
    source: "project",
    layout: "cursor",
    filePath: "/p/.cursor/agents/verifier.md",
  };
  expect(mergeCursorAgentsByPrecedence([low, high])).toEqual([high]);
});

test("listDiscoveredCursorAgents scans project .cursor/agents and prefers .cursor over .claude", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eco-cursor-agents-"));
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "eco-cursor-agents-home-"));
  try {
    await fs.mkdir(path.join(tmp, ".cursor", "agents"), { recursive: true });
    await fs.mkdir(path.join(tmp, ".claude", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, ".claude", "agents", "verifier.md"),
      `---
name: verifier
description: From Claude dir
---
`,
    );
    await fs.writeFile(
      path.join(tmp, ".cursor", "agents", "verifier.md"),
      `---
name: verifier
description: From Cursor dir
model: fast
---
`,
    );
    await fs.writeFile(
      path.join(tmp, ".cursor", "agents", "debugger.md"),
      `---
name: debugger
description: Debug failures
---
`,
    );

    const result = await listDiscoveredCursorAgents(tmp, { homedir: home });
    expect(result.workspacePath).toBe(path.resolve(tmp));
    expect(result.builtins).toContain("explore");
    expect(result.agents.map((a) => a.name).sort()).toEqual(["debugger", "verifier"]);
    const verifier = result.agents.find((a) => a.name === "verifier");
    expect(verifier?.description).toBe("From Cursor dir");
    expect(verifier?.layout).toBe("cursor");
    expect(verifier?.source).toBe("project");
    expect(verifier?.model).toBe("fast");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("listDiscoveredCursorAgents prefers project over user for same name", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eco-cursor-agents-proj-"));
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "eco-cursor-agents-user-"));
  try {
    await fs.mkdir(path.join(home, ".cursor", "agents"), { recursive: true });
    await fs.mkdir(path.join(tmp, ".cursor", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(home, ".cursor", "agents", "auditor.md"),
      `---
name: auditor
description: User auditor
---
`,
    );
    await fs.writeFile(
      path.join(tmp, ".cursor", "agents", "auditor.md"),
      `---
name: auditor
description: Project auditor
---
`,
    );

    const result = await listDiscoveredCursorAgents(tmp, { homedir: home });
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]?.description).toBe("Project auditor");
    expect(result.agents[0]?.source).toBe("project");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  }
});
