import { expect, test } from "bun:test";
import {
  buildAgentTemplatePermissionChips,
  buildAgentTemplateFromForm,
  createBlankAgentTemplateForm,
  createCopiedAgentTemplateForm,
  createUniqueTemplateId,
} from "../src/renderer/agent-template-form";
import type { AgentTemplate, ProviderConfigView } from "../src/shared/ipc";

const provider: ProviderConfigView = {
  id: "provider_1",
  name: "Provider One",
  baseUrl: "https://example.test",
  requestPath: "",
  apiCompat: "anthropic",
  defaultModel: "model-default",
  enabled: true,
  hasApiKey: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

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
  const form = createCopiedAgentTemplateForm(
    builtInTemplate,
    [
      builtInTemplate,
      {
        ...builtInTemplate,
        id: "user.research.researcher",
        builtIn: false,
        source: "user",
      },
    ],
    [provider],
  );

  expect(form.id).toBe("user.research.researcher_2");
  expect(form.name).toBe("Researcher Copy");
  expect(form.source).toBe("user");
});

test("blank template form avoids existing default ids", () => {
  const form = createBlankAgentTemplateForm(
    [provider],
    [
      {
        ...builtInTemplate,
        id: "user.custom.agent",
        builtIn: false,
        source: "user",
      },
    ],
  );

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
      providerId: provider.id,
      modelId: "model-research",
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
    defaultModelRef: { providerId: provider.id, modelId: "model-research" },
    mcpServers: ["docs"],
    skills: ["citations"],
    allowDelegation: true,
  });
  expect(template.defaultTools.bash).toEqual({ enabled: true, approval: "risky" });
  expect(template.defaultTools.mcp).toEqual({ allowedServers: ["docs"], allowedTools: ["search"] });
  expect(template.defaultTools.filesystem).toEqual({ read: "workspace", write: "none" });
  expect(template.defaultTools.network).toEqual({ webSearch: true, webFetch: false });
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
    providerId: provider.id,
    modelId: provider.defaultModel,
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
