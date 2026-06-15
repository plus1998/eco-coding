import { expect, test } from "bun:test";
import {
  buildAgentTemplateCapabilityOptions,
  buildAgentTemplateFromForm,
  buildAgentTemplatePermissionChips,
  createBlankAgentTemplateForm,
  createCopiedAgentTemplateForm,
  createUniqueTemplateId,
  normalizeDisallowedTools,
  toggleAgentTemplateDisallowedTool,
  toggleAgentTemplateListValue,
} from "../src/renderer/agent-template-form";
import type { AgentTemplate, McpServerConfigView } from "../src/shared/ipc";

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
      disallowedTools: "Write, Edit, WebFetch",
      mcpServers: "docs",
      mcpTools: "search",
      bashCommandAllowlist: "",
      bashCommandDenylist: "",
      filesystemRead: "workspace",
      filesystemWrite: "none",
      allowDelegation: true,
    },
    { nowIso: "2026-06-07T00:00:00.000Z" },
  );

  expect(template).toMatchObject({
    id: "user.research.custom",
    builtIn: false,
    source: "user",
    mcpServers: ["docs"],
    skills: [],
    allowDelegation: true,
  });
  expect(template.defaultTools.allowed).toEqual([]);
  expect(template.defaultTools.bash).toEqual({ enabled: true });
  expect(template.defaultTools.mcp).toEqual({ allowedServers: ["docs"], allowedTools: ["search"] });
  expect(template.defaultTools.filesystem).toEqual({ read: "workspace", write: "none" });
  expect(template.defaultTools.network).toEqual({ webSearch: true, webFetch: false });
});

test("buildAgentTemplateFromForm syncs delegation tools with allowDelegation", () => {
  const baseForm = {
    id: "user.custom.agent",
    name: "Custom Agent",
    description: "Agent",
    domain: "custom" as const,
    prompt: "Do work.",
    whenToUse: "Use when needed.",
    outputContract: "",
    disallowedTools: "Write",
    mcpServers: "",
    mcpTools: "",
    bashCommandAllowlist: "",
    bashCommandDenylist: "",
    filesystemRead: "workspace" as const,
    filesystemWrite: "none" as const,
    allowDelegation: false,
  };

  const blocked = buildAgentTemplateFromForm(baseForm);
  expect(blocked.defaultTools.disallowed).toEqual(
    expect.arrayContaining(["Agent", "Task", "TaskList", "TaskOutput", "Write"]),
  );

  const allowed = buildAgentTemplateFromForm({
    ...baseForm,
    allowDelegation: true,
    disallowedTools: "Write, Agent, Task",
  });
  expect(allowed.defaultTools.disallowed).toEqual(["Write"]);
});

test("normalizeDisallowedTools merges legacy bash and network flags into disallowed list", () => {
  expect(
    normalizeDisallowedTools({
      allowed: [],
      disallowed: ["Write"],
      bash: { enabled: false },
      network: { webSearch: false, webFetch: true },
    }),
  ).toEqual(["Write", "Bash", "WebSearch"]);
});

test("buildAgentTemplateCapabilityOptions merges presets, current values, and MCP config", () => {
  const mcpServers: McpServerConfigView[] = [
    mcpServer({ name: "docs", enabled: true, allowedTools: "" }),
    mcpServer({ name: "disabled", enabled: false, allowedTools: "mcp__disabled__search" }),
  ];

  const options = buildAgentTemplateCapabilityOptions({
    templates: [builtInTemplate],
    form: {
      disallowedTools: "Bash, UnknownTool",
      mcpServers: "disabled, missing",
      mcpTools: "mcp__missing__tool",
    },
    mcpServers,
  });

  expect(options.tools.map((option) => option.value)).toContain("WebSearch");
  expect(options.tools.map((option) => option.value)).not.toContain("Agent");
  expect(options.tools.map((option) => option.value)).not.toContain("Task");
  expect(options.tools.find((option) => option.value === "UnknownTool")).toMatchObject({
    sourceLabel: "当前",
  });
  expect(options.mcpServers.map((option) => option.value)).toEqual(["docs", "disabled", "missing"]);
  expect(options.mcpServers.find((option) => option.value === "disabled")).toMatchObject({
    sourceLabel: "未启用",
  });
  expect(options.mcpTools.map((option) => option.value)).toEqual(["mcp__docs__*", "mcp__missing__tool"]);
});

test("template list toggles preserve unknown values and disallowed toggles update list", () => {
  expect(toggleAgentTemplateListValue("docs, missing", "docs", false)).toBe("missing");
  expect(toggleAgentTemplateListValue("docs", "mcp__docs__*", true)).toBe("docs, mcp__docs__*");

  expect(toggleAgentTemplateDisallowedTool({ disallowedTools: "Bash, Write" }, "Read", true)).toEqual({
    disallowedTools: "Bash, Write, Read",
  });
  expect(toggleAgentTemplateDisallowedTool({ disallowedTools: "Bash, Write" }, "Bash", false)).toEqual({
    disallowedTools: "Write",
  });
});

test("buildAgentTemplatePermissionChips summarizes effective tool policy", () => {
  const chips = buildAgentTemplatePermissionChips({
    ...builtInTemplate,
    defaultTools: {
      allowed: [],
      disallowed: ["Write", "Edit", "WebSearch"],
      bash: {
        enabled: true,
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
    { label: "Bash", tone: "allow" },
    { label: "读 工作区", tone: "allow" },
    { label: "写 禁用", tone: "deny" },
    { label: "网络 Fetch", tone: "allow" },
    { label: "MCP 1 个服务/1 个工具", tone: "allow" },
    { label: "委派关闭", tone: "deny" },
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
    disallowedTools: "",
    mcpServers: "",
    mcpTools: "",
    bashCommandAllowlist: "",
    bashCommandDenylist: "",
    filesystemRead: "workspace" as const,
    filesystemWrite: "none" as const,
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
    command: "echo",
    args: [],
    env: {},
    url: "",
    headers: {},
    allowedTools: input.allowedTools,
  };
}
