import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  EcoAgentTemplateConfig,
  EcoOrchestrationProfileConfig,
  EcoToolPolicy,
} from "../src/agent-orchestration";
import {
  buildCodexGatewayModelAlias,
  resolveCodexHomeDir,
  syncCodexConfigFromEcoProviders,
} from "../src/codex-config-sync";
import {
  assertCodexRoleProvidersAvailable,
  mapEcoThinkingEffortToCodexReasoningEffort,
  sanitizeCodexRoleId,
  syncProfileAgentsToCodexRoles,
  withCodexSkillConfig,
} from "../src/codex-role-sync";

const tempDirs: string[] = [];

test("Codex effort mapping keeps max and ultra distinct", () => {
  expect(mapEcoThinkingEffortToCodexReasoningEffort("off")).toBe("none");
  expect(mapEcoThinkingEffortToCodexReasoningEffort("max")).toBe("max");
  expect(mapEcoThinkingEffortToCodexReasoningEffort("ultra")).toBe("ultra");
  expect(mapEcoThinkingEffortToCodexReasoningEffort(" focused ")).toBe("focused");
  expect(() => mapEcoThinkingEffortToCodexReasoningEffort("   ")).toThrow("non-empty string");
});

test("Codex thread Skill visibility is path-scoped", () => {
  const config = withCodexSkillConfig(
    { mcp_servers: {} },
    [
      { path: "/repo/.agents/skills/project/SKILL.md", enabled: true },
      { path: "/Users/test/.agents/skills/user/SKILL.md", enabled: false },
    ],
  );
  expect(config.skills).toEqual({
    config: [
      { path: "/repo/.agents/skills/project/SKILL.md", enabled: true },
      { path: "/Users/test/.agents/skills/user/SKILL.md", enabled: false },
    ],
  });
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeTempEcoDataDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-codex-roles-"));
  tempDirs.push(dir);
  return dir;
}

test("syncProfileAgentsToCodexRoles writes role toml for explore and enabled agents", async () => {
  const ecoDataDir = await makeTempEcoDataDir();
  const codexHomeDir = resolveCodexHomeDir(ecoDataDir);
  const templates = [researchTemplate, codingTemplate];

  const result = await syncProfileAgentsToCodexRoles({
    codexHomeDir,
    profile: buildProfile(),
    templates,
  });

  expect(result.roleIds).toEqual(["explore", "researcher", "coder"]);
  expect(result.agentRoles.map((role) => role.roleId)).toEqual(["explore", "researcher", "coder"]);
  expect(result.roles.map((role) => role.modelId)).toEqual([
    "explore-model",
    "research-model",
    "coder-model",
  ]);
  const exploreToml = await fs.readFile(path.join(result.agentsDir, "explore.toml"), "utf8");
  expect(exploreToml).toContain('name = "explore"');
  expect(exploreToml).toContain("Read-only codebase exploration");
  expect(exploreToml).toContain("You are a read-only codebase exploration subagent.");
  expect(exploreToml).toContain("Do not create, edit, or delete files.");
  expect(exploreToml).not.toContain('developer_instructions = ""');
  expect(exploreToml).toContain('sandbox_mode = "read-only"');
  expect(exploreToml).toContain('approval_policy = "on-request"');
  expect(exploreToml).toContain('model = "eco_main__explore-model"');
  expect(exploreToml).toContain('model_provider = "eco_main"');
  const researcherToml = await fs.readFile(path.join(result.agentsDir, "researcher.toml"), "utf8");
  expect(researcherToml).toContain('name = "researcher"');
  expect(researcherToml).toContain("developer_instructions = ");
  expect(researcherToml).toContain("Research carefully and cite sources.");
  expect(researcherToml).toContain('sandbox_mode = "read-only"');
  expect(researcherToml).toContain('web_search = "live"');
  expect(researcherToml).toContain('model = "eco_main__research-model"');
  expect(researcherToml).toContain('model_provider = "eco_main"');
  const coderToml = await fs.readFile(path.join(result.agentsDir, "coder.toml"), "utf8");
  expect(coderToml).toContain('model_reasoning_effort = "high"');
  await expect(fs.stat(path.join(result.agentsDir, "architect.toml"))).rejects.toThrow();
});

test("syncProfileAgentsToCodexRoles reads Explore from the editable roster", async () => {
  const ecoDataDir = await makeTempEcoDataDir();
  const profile = buildProfile();
  const { builtinAgents: _legacyBuiltinAgents, ...profileWithoutLegacyExplore } = profile;
  const result = await syncProfileAgentsToCodexRoles({
    codexHomeDir: resolveCodexHomeDir(ecoDataDir),
    profile: {
      ...profileWithoutLegacyExplore,
      agents: [
        {
          agentKey: "explore",
          templateId: "builtin.coding.explore",
          displayName: "Explore",
          modelRef: { providerId: "fast", modelId: "explore-roster" },
          tools: toolPolicy({ sandboxMode: "read-only" }),
          mcpServers: [],
          skills: [],
          enabled: true,
        },
        ...profile.agents,
      ],
    },
    templates: [researchTemplate, codingTemplate],
  });

  expect(result.roleIds).toEqual(["explore", "researcher", "coder"]);
  expect(result.roles[0]?.modelId).toBe("explore-roster");
});

test("multi-agent config keeps roles thread-scoped and heterogeneous models immutable", async () => {
  const ecoDataDir = await makeTempEcoDataDir();
  const codexHomeDir = resolveCodexHomeDir(ecoDataDir);
  const profile = buildProfile({
    builtinAgents: {
      explore: { modelRef: { providerId: "fast", modelId: "explore-fast" } },
    },
    agents: [
      {
        ...firstProfileAgent(),
        agentKey: "coder",
        templateId: codingTemplate.id,
        displayName: "Implementation Coder",
        modelRef: { providerId: "strong", modelId: "coder-strong", thinkingEffort: "high" },
        enabled: true,
      },
    ],
  });

  const roleSync = await syncProfileAgentsToCodexRoles({
    codexHomeDir,
    profile,
    templates: [codingTemplate],
  });
  assertCodexRoleProvidersAvailable(roleSync.roles, [
    { id: "fast", name: "Fast", enabled: true },
    { id: "strong", name: "Strong", enabled: true },
  ]);

  const configSync = await syncCodexConfigFromEcoProviders({
    ecoDataDir,
    providers: [
      { id: "fast", name: "Fast", enabled: true },
      { id: "strong", name: "Strong", enabled: true },
    ],
    agentRoles: roleSync.agentRoles,
  });

  const configToml = await fs.readFile(configSync.configPath, "utf8");
  expect(configToml).not.toContain("multi_agent_v2");
  expect(configToml).toContain("multi_agent = true");
  expect(configToml).toContain("[features]");
  expect(configToml).toContain("[agents]");
  expect(configToml).toContain("max_threads = 16");
  expect(configToml).toContain("max_depth = 1");
  expect(configToml).not.toContain("[agents.explore]");
  expect(configToml).not.toContain("[agents.coder]");
  expect(configToml).not.toContain("config_file");
  expect(configToml).toContain("[model_providers.eco_fast]");
  expect(configToml).toContain("[model_providers.eco_strong]");
  expect(roleSync.threadConfig.agents?.explore).toEqual({
    description: roleSync.roles.find((role) => role.roleId === "explore")?.description,
    config_file: roleSync.roles.find((role) => role.roleId === "explore")?.rolePath,
  });
  expect(roleSync.threadConfig.agents?.coder).toEqual({
    description: roleSync.roles.find((role) => role.roleId === "coder")?.description,
    config_file: roleSync.roles.find((role) => role.roleId === "coder")?.rolePath,
  });

  const exploreToml = await fs.readFile(path.join(roleSync.agentsDir, "explore.toml"), "utf8");
  const coderToml = await fs.readFile(path.join(roleSync.agentsDir, "coder.toml"), "utf8");
  expect(exploreToml).toContain('model = "eco_fast__explore-fast"');
  expect(exploreToml).toContain('model_provider = "eco_fast"');
  expect(coderToml).toContain('model = "eco_strong__coder-strong"');
  expect(coderToml).toContain('model_provider = "eco_strong"');
});

test("role TOML carries an explicit apiCompat override in the V1 gateway alias", async () => {
  const ecoDataDir = await makeTempEcoDataDir();
  const codexHomeDir = resolveCodexHomeDir(ecoDataDir);
  const roleSync = await syncProfileAgentsToCodexRoles({
    codexHomeDir,
    profile: buildProfile({
      builtinAgents: {
        explore: {
          modelRef: {
            providerId: "mixed-wire",
            modelId: "chat/model.__v1",
            apiCompat: "openai_chat_completions",
          },
        },
      },
      agents: [],
    }),
    templates: [],
  });

  expect(roleSync.roles[0]?.apiCompat).toBe("openai_chat_completions");
  const exploreToml = await fs.readFile(path.join(roleSync.agentsDir, "explore.toml"), "utf8");
  expect(exploreToml).toContain(
    `model = "${buildCodexGatewayModelAlias(
      "mixed-wire",
      "chat/model.__v1",
      "openai_chat_completions",
    )}"`,
  );
});

test("responses-native providers reject non-Responses role overrides", async () => {
  const ecoDataDir = await makeTempEcoDataDir();
  const roleSync = await syncProfileAgentsToCodexRoles({
    codexHomeDir: resolveCodexHomeDir(ecoDataDir),
    profile: buildProfile({
      builtinAgents: {
        explore: {
          modelRef: {
            providerId: "native",
            modelId: "chat-model",
            apiCompat: "anthropic",
          },
        },
      },
      agents: [],
    }),
    templates: [],
  });

  expect(() =>
    assertCodexRoleProvidersAvailable(roleSync.roles, [
      {
        id: "native",
        name: "Native Responses",
        enabled: true,
        apiCompat: "openai_responses",
        compactionMode: "responses-native",
      },
    ]),
  ).toThrow(/cannot override provider 'native' to apiCompat=anthropic/);
});

test("role sync rejects unknown apiCompat values", async () => {
  const ecoDataDir = await makeTempEcoDataDir();
  await expect(
    syncProfileAgentsToCodexRoles({
      codexHomeDir: resolveCodexHomeDir(ecoDataDir),
      profile: buildProfile({
        builtinAgents: {
          explore: {
            modelRef: {
              providerId: "main",
              modelId: "explore-model",
              apiCompat: "unknown-wire",
            },
          },
        },
        agents: [],
      }),
      templates: [],
    }),
  ).rejects.toThrow("unsupported modelRef.apiCompat 'unknown-wire'");
});

test("syncProfileAgentsToCodexRoles keeps old bundles immutable when availability changes", async () => {
  const ecoDataDir = await makeTempEcoDataDir();
  const codexHomeDir = resolveCodexHomeDir(ecoDataDir);
  const coderAgent = buildProfile().agents.find((agent) => agent.agentKey === "coder");
  if (!coderAgent) {
    throw new Error("Expected coder fixture agent.");
  }
  const profile = buildProfile({
    agents: [coderAgent],
  });

  const initial = await syncProfileAgentsToCodexRoles({
    codexHomeDir,
    profile,
    templates: [codingTemplate],
  });
  const initialCoderPath = initial.roles.find((role) => role.roleId === "coder")?.rolePath;
  expect(initialCoderPath).toBeTruthy();
  expect(await fs.stat(initialCoderPath!)).toBeTruthy();

  const exploreOnly = await syncProfileAgentsToCodexRoles({
    codexHomeDir,
    profile,
    templates: [codingTemplate],
    subagentAvailability: { explore: true, coder: false },
  });

  expect(exploreOnly.roleIds).toEqual(["explore"]);
  expect(exploreOnly.agentsDir).not.toBe(initial.agentsDir);
  expect(await fs.stat(initialCoderPath!)).toBeTruthy();
});

test("role sync explicitly disables multi-agent features when no role is available", async () => {
  const ecoDataDir = await makeTempEcoDataDir();
  const result = await syncProfileAgentsToCodexRoles({
    codexHomeDir: resolveCodexHomeDir(ecoDataDir),
    profile: buildProfile({ agents: [] }),
    templates: [],
    subagentAvailability: { explore: false },
  });

  expect(result.roleIds).toEqual([]);
  expect(result.threadConfig.features).toEqual({ multi_agent: false, hooks: false });
  expect(result.threadConfig.agents).toBeUndefined();
});

test("assertCodexRoleProvidersAvailable fails when role provider is missing", async () => {
  const ecoDataDir = await makeTempEcoDataDir();
  const codexHomeDir = resolveCodexHomeDir(ecoDataDir);
  const roleSync = await syncProfileAgentsToCodexRoles({
    codexHomeDir,
    profile: buildProfile({
      builtinAgents: {
        explore: { modelRef: { providerId: "missing-provider", modelId: "explore-model" } },
      },
      agents: [],
    }),
    templates: [],
  });

  expect(() =>
    assertCodexRoleProvidersAvailable(roleSync.roles, [
      { id: "main", name: "Main", enabled: true },
    ]),
  ).toThrow(/requires provider 'missing-provider'/);
});

test("syncProfileAgentsToCodexRoles sanitizes unsafe keys without path traversal", async () => {
  const ecoDataDir = await makeTempEcoDataDir();
  const codexHomeDir = resolveCodexHomeDir(ecoDataDir);
  const agent = firstProfileAgent();
  const profile = buildProfile({
    agents: [
      {
        ...agent,
        agentKey: "../Deep Research!",
      },
    ],
  });

  const result = await syncProfileAgentsToCodexRoles({
    codexHomeDir,
    profile,
    templates: [researchTemplate],
  });

  expect(sanitizeCodexRoleId("../Deep Research!")).toBe("deep_research");
  expect(result.roleIds).toEqual(["explore", "deep_research"]);
  expect(result.roles.find((role) => role.roleId === "deep_research")?.rolePath).toBe(
    path.join(result.agentsDir, "deep_research.toml"),
  );
  await expect(fs.stat(path.join(codexHomeDir, "Deep Research!.toml"))).rejects.toThrow();
});

test("syncProfileAgentsToCodexRoles rejects duplicate sanitized keys", async () => {
  const ecoDataDir = await makeTempEcoDataDir();
  const codexHomeDir = resolveCodexHomeDir(ecoDataDir);
  const agent = firstProfileAgent();

  await expect(
    syncProfileAgentsToCodexRoles({
      codexHomeDir,
      profile: buildProfile({
        agents: [
          { ...agent, agentKey: "a/b" },
          { ...agent, agentKey: "a_b" },
        ],
      }),
      templates: [researchTemplate],
    }),
  ).rejects.toThrow("Duplicate Codex role id");
});

test("syncProfileAgentsToCodexRoles rejects case-only collisions and reserved Explore", async () => {
  const ecoDataDir = await makeTempEcoDataDir();
  const codexHomeDir = resolveCodexHomeDir(ecoDataDir);
  const agent = firstProfileAgent();

  await expect(
    syncProfileAgentsToCodexRoles({
      codexHomeDir,
      profile: buildProfile({
        agents: [
          { ...agent, agentKey: "Researcher" },
          { ...agent, agentKey: "researcher" },
        ],
      }),
      templates: [researchTemplate],
    }),
  ).rejects.toThrow("Duplicate Codex role id 'researcher'");

  await expect(
    syncProfileAgentsToCodexRoles({
      codexHomeDir,
      profile: buildProfile({ agents: [{ ...agent, agentKey: "Explore" }] }),
      templates: [researchTemplate],
    }),
  ).rejects.toThrow("reserved Codex explore role id");
});

test("syncProfileAgentsToCodexRoles redacts known secrets from roles and config declarations", async () => {
  const ecoDataDir = await makeTempEcoDataDir();
  const codexHomeDir = resolveCodexHomeDir(ecoDataDir);
  const secret = "sk-live-secret-value";
  const secretTemplate: EcoAgentTemplateConfig = {
    ...researchTemplate,
    prompt: `Use this role. Accidental secret: ${secret}`,
    description: `Research role ${secret}`,
  };

  const roleSync = await syncProfileAgentsToCodexRoles({
    codexHomeDir,
    profile: buildProfile({ agents: [firstProfileAgent()] }),
    templates: [secretTemplate],
    secretsToRedact: [secret],
  });
  await syncCodexConfigFromEcoProviders({
    ecoDataDir,
    providers: [{ id: "main", name: "Main", enabled: true }],
    agentRoles: roleSync.agentRoles,
  });

  const roleToml = await fs.readFile(path.join(roleSync.agentsDir, "researcher.toml"), "utf8");
  const configToml = await fs.readFile(path.join(codexHomeDir, "config.toml"), "utf8");
  const threadConfig = JSON.stringify(roleSync.threadConfig);
  expect(roleToml).not.toContain(secret);
  expect(configToml).not.toContain(secret);
  expect(threadConfig).not.toContain(secret);
  expect(roleToml).toContain("[redacted]");
  expect(threadConfig).toContain("[redacted]");
});

test("role MCP policy explicitly denies inherited servers and intersects tool allowlists", async () => {
  const ecoDataDir = await makeTempEcoDataDir();
  const profile = buildProfile({
    mainAgent: {
      ...buildProfile().mainAgent,
      tools: toolPolicy({
        allowSpawn: true,
        mcp: { allowedServers: ["github"], enabledTools: ["read", "missing"] },
      }),
    },
    agents: [
      {
        ...firstProfileAgent(),
        tools: toolPolicy({
          sandboxMode: "read-only",
          mcp: { allowedServers: ["browser"], enabledTools: ["search", "missing"] },
        }),
      },
    ],
  });

  const result = await syncProfileAgentsToCodexRoles({
    codexHomeDir: resolveCodexHomeDir(ecoDataDir),
    profile,
    templates: [researchTemplate],
    mcpServers: [
      { name: "browser", transport: "stdio", command: "node", enabledTools: ["search", "open"] },
      { name: "github", transport: "stdio", command: "node", enabledTools: ["read", "write"] },
      { name: "sources", transport: "stdio", command: "node" },
    ],
    threadEnabledMcpServers: ["browser", "github", "sources"],
  });

  expect(result.threadConfig.mcp_servers).toEqual({
    browser: { enabled: false },
    github: { enabled: true, enabled_tools: ["read"] },
    sources: { enabled: false },
  });
  const researcherConfig = result.roleThreadConfigs.researcher;
  expect(researcherConfig?.mcp_servers).toEqual({
    browser: { enabled: true, enabled_tools: ["search"] },
    github: { enabled: false },
    sources: { enabled: true, enabled_tools: ["missing", "search"] },
  });

  const researcherToml = await fs.readFile(
    result.roles.find((role) => role.roleId === "researcher")!.rolePath,
    "utf8",
  );
  expect(researcherToml).toContain("[mcp_servers.browser]");
  expect(researcherToml).toContain('enabled_tools = ["search"]');
  expect(researcherToml).toMatch(/\[mcp_servers\.github\][\s\S]*?enabled = false/);
  expect(researcherToml).not.toContain("Eco MCP allowlist");
});

test("main actor inherits Composer-selected MCP when its Profile has no MCP policy", async () => {
  const ecoDataDir = await makeTempEcoDataDir();
  const profile = buildProfile({ agents: [], builtinAgents: undefined });

  const result = await syncProfileAgentsToCodexRoles({
    codexHomeDir: resolveCodexHomeDir(ecoDataDir),
    profile,
    templates: [],
    mcpServers: [
      { name: "mongo", transport: "stdio", command: "node" },
      { name: "browser", transport: "stdio", command: "node" },
    ],
    threadEnabledMcpServers: ["mongo"],
  });

  expect(result.threadConfig.mcp_servers).toEqual({
    browser: { enabled: false },
    mongo: { enabled: true },
  });
});

test("explicit empty main MCP policy denies Composer-selected MCP", async () => {
  const ecoDataDir = await makeTempEcoDataDir();
  const base = buildProfile();
  const profile = buildProfile({
    mainAgent: {
      ...base.mainAgent,
      tools: toolPolicy({ mcp: { allowedServers: [] } }),
    },
    agents: [],
    builtinAgents: undefined,
  });

  const result = await syncProfileAgentsToCodexRoles({
    codexHomeDir: resolveCodexHomeDir(ecoDataDir),
    profile,
    templates: [],
    mcpServers: [{ name: "mongo", transport: "stdio", command: "node" }],
    threadEnabledMcpServers: ["mongo"],
  });

  expect(result.threadConfig.mcp_servers).toEqual({ mongo: { enabled: false } });
});

test("content-addressed role bundles survive a concurrent Profile preparation", async () => {
  const ecoDataDir = await makeTempEcoDataDir();
  const codexHomeDir = resolveCodexHomeDir(ecoDataDir);
  const first = await syncProfileAgentsToCodexRoles({
    codexHomeDir,
    profile: buildProfile({ agents: [firstProfileAgent()] }),
    templates: [researchTemplate],
    mcpServers: [
      { name: "browser", transport: "stdio", command: "node" },
      { name: "sources", transport: "stdio", command: "node" },
    ],
    threadEnabledMcpServers: ["browser"],
  });
  const firstRole = first.roles.find((role) => role.roleId === "researcher");
  if (!firstRole) {
    throw new Error("Expected researcher role.");
  }
  const before = await fs.readFile(firstRole.rolePath, "utf8");

  const second = await syncProfileAgentsToCodexRoles({
    codexHomeDir,
    profile: buildProfile({
      agents: [
        {
          ...firstProfileAgent(),
          modelRef: { providerId: "main", modelId: "research-model-v2" },
        },
      ],
    }),
    templates: [researchTemplate],
    mcpServers: [
      { name: "browser", transport: "stdio", command: "node" },
      { name: "sources", transport: "stdio", command: "node" },
    ],
    threadEnabledMcpServers: ["sources"],
  });

  expect(second.agentsDir).not.toBe(first.agentsDir);
  expect(await fs.readFile(firstRole.rolePath, "utf8")).toBe(before);
  expect(first.threadConfig.agents?.researcher).toMatchObject({ config_file: firstRole.rolePath });
});

test("role sync rejects an unenumerated child MCP widening over the main actor", async () => {
  const ecoDataDir = await makeTempEcoDataDir();
  const base = buildProfile();
  await expect(
    syncProfileAgentsToCodexRoles({
      codexHomeDir: resolveCodexHomeDir(ecoDataDir),
      profile: buildProfile({
        mainAgent: {
          ...base.mainAgent,
          tools: toolPolicy({
            allowSpawn: true,
            mcp: { allowedServers: ["browser"], enabledTools: ["search"] },
          }),
        },
        agents: [firstProfileAgent()],
      }),
      templates: [researchTemplate],
      mcpServers: [{ name: "browser", transport: "stdio", command: "node" }],
      threadEnabledMcpServers: ["browser"],
    }),
  ).rejects.toThrow("cannot remove that inherited list");
});

function toolPolicy(overrides: Partial<EcoToolPolicy> = {}): EcoToolPolicy {
  return {
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    networkAccess: false,
    webSearch: "disabled",
    allowSpawn: false,
    ...overrides,
  };
}

const updatedAt = "2026-07-04T00:00:00.000Z";

const researchTemplate: EcoAgentTemplateConfig = {
  id: "template.research",
  name: "Researcher",
  description: "Finds evidence.",
  domain: "research",
  prompt: "Research carefully and cite sources.",
  whenToUse: "Need external context.",
  outputContract: "Return bullets with sources.",
  defaultTools: toolPolicy({
    sandboxMode: "read-only",
    webSearch: "live",
  }),
  mcpServers: ["sources"],
  skills: [],
  allowDelegation: false,
  builtIn: false,
  source: "user",
  version: 1,
  updatedAt,
};

const codingTemplate: EcoAgentTemplateConfig = {
  ...researchTemplate,
  id: "template.coder",
  name: "Coder",
  description: "Implements code changes.",
  domain: "coding",
  prompt: "Implement scoped code changes.",
  whenToUse: "Need implementation.",
  outputContract: "Return changed files and tests.",
  defaultTools: toolPolicy({ sandboxMode: "workspace-write" }),
};

function buildProfile(overrides: Partial<EcoOrchestrationProfileConfig> = {}): EcoOrchestrationProfileConfig {
  const profile: EcoOrchestrationProfileConfig = {
    id: "profile.coding-default",
    name: "Coding Default",
    preset: "coding",
    mainAgent: {
      agentKey: "main",
      name: "Main",
      domain: "coding",
      systemPromptPreset: "custom_append",
      prompt: "Coordinate work.",
      modelRef: { providerId: "main", modelId: "main-model" },
      tools: toolPolicy({ sandboxMode: "workspace-write", allowSpawn: true }),
      skills: [],
    },
    builtinAgents: {
      explore: {
        modelRef: { providerId: "main", modelId: "explore-model" },
      },
    },
    agents: [
      {
        agentKey: "researcher",
        templateId: researchTemplate.id,
        displayName: "Evidence Researcher",
        modelRef: { providerId: "main", modelId: "research-model", thinkingEffort: "off" },
        tools: toolPolicy({ sandboxMode: "read-only", webSearch: "live" }),
        mcpServers: ["browser"],
        skills: ["citation"],
        enabled: true,
      },
      {
        agentKey: "coder",
        templateId: codingTemplate.id,
        displayName: "Implementation Coder",
        modelRef: { providerId: "main", modelId: "coder-model", thinkingEffort: "high" },
        tools: toolPolicy({ sandboxMode: "workspace-write" }),
        mcpServers: [],
        skills: [],
        enabled: true,
      },
      {
        agentKey: "architect",
        templateId: codingTemplate.id,
        displayName: "Disabled Architect",
        modelRef: { providerId: "main", modelId: "architect-model" },
        tools: toolPolicy({ sandboxMode: "read-only" }),
        mcpServers: [],
        skills: [],
        enabled: false,
      },
    ],
    strategy: { kind: "autonomous", guidancePrompt: "Delegate when it helps." },
    version: 1,
    updatedAt,
    source: "user",
  };
  return { ...profile, ...overrides };
}

function firstProfileAgent(): EcoOrchestrationProfileConfig["agents"][number] {
  const agent = buildProfile().agents[0];
  if (!agent) {
    throw new Error("Expected profile fixture to include an agent.");
  }
  return agent;
}
