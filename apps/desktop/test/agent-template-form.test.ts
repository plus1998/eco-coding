import { expect, test } from "bun:test";
import {
  buildAgentTemplateCapabilityOptions,
  buildAgentTemplateFromForm,
  buildAgentTemplatePermissionChips,
  createBlankAgentTemplateForm,
  createCopiedAgentTemplateForm,
  createUniqueTemplateId,
  toggleAgentTemplateListValue,
  toggleAgentTemplateToolSelection,
} from "../src/renderer/agent-template-form";
import type { AgentTemplate, McpServerConfigView, SkillsListResult } from "../src/shared/ipc";

const builtInTemplate: AgentTemplate = {
  id: "builtin.research.researcher",
  name: "Researcher",
  description: "Research agent",
  domain: "research",
  prompt: "Research.",
  whenToUse: "Use for research.",
  defaultTools: { allowed: ["Read", "WebSearch"], disallowed: ["Bash"] },
  mcpServers: [],
  skills: [],
  allowDelegation: false,
  builtIn: true,
  source: "built_in",
  version: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("copied built-in template becomes a user template form with unique id", () => {
  const form = createCopiedAgentTemplateForm(builtInTemplate, [
    builtInTemplate,
    {
      ...builtInTemplate,
      id: "user.research.researcher",
      builtIn: false,
      source: "user",
    },
  ]);

  expect(form.id).toBe("user.research.researcher_2");
  expect(form.name).toBe("Researcher Copy");
  expect(form.source).toBe("user");
});

test("blank template form avoids existing default ids", () => {
  const form = createBlankAgentTemplateForm([
    {
      ...builtInTemplate,
      id: "user.custom.agent",
      builtIn: false,
      source: "user",
    },
  ]);

  expect(form.id).toBe("user.custom.agent_2");
});

test("buildAgentTemplateFromForm validates and derives tool policy", () => {
  const template = buildAgentTemplateFromForm(
    {
      id: "user.research.custom",
      name: "Custom Research",
      description: "Custom research agent",
      domain: "research",
      prompt: "Research deeply.",
      whenToUse: "Use for research.",
      outputContract: "Return sources.",
      allowedTools: "Read, WebSearch, Bash",
      disallowedTools: "Write, Edit",
      mcpServers: "docs",
      mcpTools: "search",
      skills: "citations",
      allowDelegation: true,
      source: "project",
    },
    { nowIso: "2026-06-07T00:00:00.000Z" },
  );

  expect(template).toMatchObject({
    id: "user.research.custom",
    builtIn: false,
    source: "project",
    mcpServers: ["docs"],
    skills: ["citations"],
    allowDelegation: true,
  });
  expect(template.defaultTools.bash).toEqual({ enabled: true, approval: "risky" });
  expect(template.defaultTools.mcp).toEqual({ allowedServers: ["docs"], allowedTools: ["search"] });
  expect(template.defaultTools.filesystem).toEqual({ read: "workspace", write: "none" });
  expect(template.defaultTools.network).toEqual({ webSearch: true, webFetch: false });
});

test("buildAgentTemplateCapabilityOptions merges presets, current values, MCP config, and SDK-ready skills", () => {
  const mcpServers: McpServerConfigView[] = [
    mcpServer({ name: "docs", enabled: true, allowedTools: "" }),
    mcpServer({ name: "disabled", enabled: false, allowedTools: "mcp__disabled__search" }),
  ];
  const skillsSnapshot: SkillsListResult = {
    workspacePath: "/repo",
    userSkills: [
      {
        name: "citation",
        description: "Cite sources.",
        source: "user",
        directory: "/home/.claude/skills/citation",
        skillFilePath: "/home/.claude/skills/citation/SKILL.md",
        layout: "claude",
        sdkReady: true,
        baseDir: "/home",
      },
    ],
    projectSkills: [
      {
        name: "project-skill",
        description: "Project skill.",
        source: "project",
        directory: "/repo/.claude/skills/project-skill",
        skillFilePath: "/repo/.claude/skills/project-skill/SKILL.md",
        layout: "claude",
        sdkReady: true,
        baseDir: "/repo",
      },
    ],
    agentsOnlySkills: [
      {
        name: "unlinked",
        description: "Needs link.",
        source: "user",
        directory: "/home/.agents/skills/unlinked",
        skillFilePath: "/home/.agents/skills/unlinked/SKILL.md",
        layout: "agents",
        sdkReady: false,
        baseDir: "/home",
      },
    ],
    scannedAt: "2026-06-07T00:00:00.000Z",
  };

  const options = buildAgentTemplateCapabilityOptions({
    templates: [builtInTemplate],
    form: {
      allowedTools: "UnknownTool, Read",
      disallowedTools: "Bash",
      mcpServers: "disabled, missing",
      mcpTools: "mcp__missing__tool",
      skills: "unlinked, ghost",
    },
    mcpServers,
    skillsSnapshot,
  });

  expect(options.tools.map((option) => option.value)).toContain("WebSearch");
  expect(options.tools.find((option) => option.value === "Skill")).toMatchObject({
    sourceLabel: "Claude",
  });
  expect(options.tools.find((option) => option.value === "UnknownTool")).toMatchObject({
    sourceLabel: "当前",
  });
  expect(options.mcpServers.map((option) => option.value)).toEqual(["docs", "disabled", "missing"]);
  expect(options.mcpServers.find((option) => option.value === "disabled")).toMatchObject({
    sourceLabel: "未启用",
  });
  expect(options.mcpTools.map((option) => option.value)).toEqual(["mcp__docs__*", "mcp__missing__tool"]);
  expect(options.skills.find((option) => option.value === "citation")).toMatchObject({
    sourceLabel: "Claude",
  });
  expect(options.skills.find((option) => option.value === "project-skill")).toMatchObject({
    sourceLabel: "项目",
  });
  expect(options.skills.find((option) => option.value === "unlinked")).toMatchObject({
    sourceLabel: "当前未链接",
  });
  expect(options.skills.find((option) => option.value === "ghost")).toMatchObject({
    sourceLabel: "未发现",
  });
});

test("template list toggles preserve unknown values and tool toggles are mutually exclusive", () => {
  expect(toggleAgentTemplateListValue("docs, missing", "docs", false)).toBe("missing");
  expect(toggleAgentTemplateListValue("docs", "mcp__docs__*", true)).toBe("docs, mcp__docs__*");

  expect(
    toggleAgentTemplateToolSelection(
      { allowedTools: "Read, CustomTool", disallowedTools: "Bash, Write" },
      "allowedTools",
      "Bash",
      true,
    ),
  ).toEqual({
    allowedTools: "Read, CustomTool, Bash",
    disallowedTools: "Write",
  });
  expect(
    toggleAgentTemplateToolSelection(
      { allowedTools: "Read, Bash", disallowedTools: "Write" },
      "disallowedTools",
      "Read",
      true,
    ),
  ).toEqual({
    allowedTools: "Bash",
    disallowedTools: "Write, Read",
  });
});

test("buildAgentTemplatePermissionChips summarizes effective tool policy", () => {
  const chips = buildAgentTemplatePermissionChips({
    ...builtInTemplate,
    defaultTools: {
      allowed: ["Read", "Bash", "WebFetch"],
      disallowed: ["Write", "Edit", "WebSearch"],
      bash: {
        enabled: true,
        approval: "always",
        commandAllowlist: ["bun test"],
        commandDenylist: ["rm*"],
      },
      filesystem: { read: "workspace", write: "none" },
      network: { webSearch: false, webFetch: true },
      mcp: { allowedServers: ["docs"], allowedTools: ["mcp__docs__search"] },
    },
    mcpServers: ["docs"],
  });

  expect(chips).toEqual([
    { label: "Bash 每次确认", tone: "allow" },
    { label: "读 工作区", tone: "allow" },
    { label: "写 禁用", tone: "deny" },
    { label: "网络 Fetch", tone: "allow" },
    { label: "MCP 1 个服务/1 个工具", tone: "allow" },
    { label: "命令白名单 1", tone: "allow" },
    { label: "命令黑名单 1", tone: "deny" },
    { label: "禁用 Write/Edit/WebSearch", tone: "deny" },
  ]);
});

test("template form rejects protected and malformed ids", () => {
  const baseForm = {
    id: "builtin.custom.agent",
    name: "Agent",
    description: "Agent",
    domain: "custom" as const,
    prompt: "Do work.",
    whenToUse: "Use when needed.",
    outputContract: "",
    allowedTools: "",
    disallowedTools: "",
    mcpServers: "",
    mcpTools: "",
    skills: "",
    allowDelegation: false,
    source: "user" as const,
  };

  expect(() => buildAgentTemplateFromForm(baseForm)).toThrow("内置子代理模板 id 不可用于用户配置");
  expect(() => buildAgentTemplateFromForm({ ...baseForm, id: "bad id" })).toThrow("子代理模板 id 只能包含");
});

test("createUniqueTemplateId increments suffixes", () => {
  expect(createUniqueTemplateId("user.custom.agent", ["user.custom.agent", "user.custom.agent_2"])).toBe(
    "user.custom.agent_3",
  );
});

function mcpServer(input: { name: string; enabled: boolean; allowedTools: string }): McpServerConfigView {
  return {
    id: `mcp_${input.name}`,
    name: input.name,
    transport: "stdio",
    enabled: input.enabled,
    command: "node",
    argsJson: "[]",
    envJson: "{}",
    headersJson: "{}",
    allowedTools: input.allowedTools,
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
  };
}
