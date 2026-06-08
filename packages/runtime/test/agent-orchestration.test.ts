import { expect, test } from "bun:test";
import {
  buildMainAgentSystemPrompt,
  buildToolPermissionPolicyFromProfile,
  createAgentDefinitionsFromProfile,
  type EcoAgentTemplateConfig,
  type EcoOrchestrationProfileConfig,
  type EcoToolPolicy,
  resolveMainAgentAllowedTools,
  sdkAgentKeyForProfileAgent,
} from "../src/agent-orchestration";

const updatedAt = "2026-06-07T00:00:00.000Z";

function toolPolicy(
  allowed: string[],
  disallowed: string[] = [],
  mcp?: { allowedServers: string[]; allowedTools: string[] },
): EcoToolPolicy {
  return { allowed, disallowed, ...(mcp ? { mcp } : {}) };
}

function modelRef(modelId: string) {
  return { providerId: "provider", modelId };
}

const researchTemplate: EcoAgentTemplateConfig = {
  id: "user.research.deep",
  name: "Deep Researcher",
  description: "Collects credible sources and competing views.",
  domain: "research",
  prompt: "CHILD SECRET PROMPT: research broadly and cite carefully.",
  whenToUse: "Need sourced findings or external context",
  outputContract: "Return findings, sources, confidence, and open questions.",
  defaultTools: toolPolicy(["WebSearch", "WebFetch"], ["Write"]),
  mcpServers: ["sources"],
  skills: ["citation"],
  allowDelegation: false,
  builtIn: false,
  source: "user",
  version: 1,
  updatedAt,
};

const profile: EcoOrchestrationProfileConfig = {
  id: "profile.research",
  name: "Research Desk",
  preset: "research",
  mainAgent: {
    agentKey: "main",
    name: "Research Coordinator",
    domain: "research",
    systemPromptPreset: "custom",
    prompt: "You coordinate research work without assuming a coding task.",
    modelRef: modelRef("main-model"),
    tools: toolPolicy(["Agent", "Read", "WebSearch"], ["Write"], {
      allowedServers: ["browser"],
      allowedTools: ["mcp__sources__quote"],
    }),
    skills: [],
  },
  agents: [
    {
      agentKey: "researcher",
      templateId: researchTemplate.id,
      displayName: "Evidence Researcher",
      modelRef: modelRef("research-model"),
      tools: toolPolicy(["Read", "WebSearch"], ["Bash"]),
      mcpServers: ["browser"],
      skills: ["pdf"],
      enabled: true,
    },
    {
      agentKey: "disabled",
      templateId: researchTemplate.id,
      modelRef: modelRef("disabled-model"),
      tools: toolPolicy(["Read"]),
      mcpServers: [],
      skills: [],
      enabled: false,
    },
  ],
  strategy: { kind: "autonomous", guidancePrompt: "Delegate only when evidence quality improves." },
  version: 1,
  updatedAt,
  source: "user",
};

function requireElement<T>(values: readonly T[], index: number, label: string): T {
  const value = values[index];
  if (!value) {
    throw new Error(`${label} ${index} missing in test fixture.`);
  }
  return value;
}

test("createAgentDefinitionsFromProfile builds enabled SDK agent definitions", () => {
  const resolved = createAgentDefinitionsFromProfile(profile, [researchTemplate]);

  expect(resolved.agentKeys).toEqual(["eco_researcher"]);
  expect(resolved.definitions).not.toHaveProperty("eco_disabled");

  const definition = resolved.definitions.eco_researcher as Record<string, unknown>;
  expect(definition).toMatchObject({
    model: "research-model",
    tools: ["Read", "WebSearch", "mcp__sources__*", "mcp__browser__*", "Skill"],
    disallowedTools: ["Bash", "Agent", "Task"],
    prompt: researchTemplate.prompt,
    mcpServers: ["sources", "browser"],
    skills: ["citation", "pdf"],
  });
  expect(definition.description).toContain("Evidence Researcher");
  expect(definition.description).toContain("Use when: Need sourced findings or external context");
});

test("createAgentDefinitionsFromProfile merges dynamic session skills", () => {
  const resolved = createAgentDefinitionsFromProfile(profile, [researchTemplate], {
    agentSkills: { eco_researcher: ["workspace-research"] },
  });

  const definition = resolved.definitions.eco_researcher as Record<string, unknown>;
  expect(definition.skills).toEqual(["citation", "pdf", "workspace-research"]);
});

test("buildMainAgentSystemPrompt injects roster without leaking child prompts", () => {
  const prompt = buildMainAgentSystemPrompt(profile, [researchTemplate], "PHASE APPEND");

  expect(typeof prompt).toBe("string");
  expect(prompt).toContain("You coordinate research work without assuming a coding task.");
  expect(prompt).toContain("PHASE APPEND");
  expect(prompt).toContain("Agent(eco_researcher)");
  expect(prompt).toContain("Need sourced findings or external context");
  expect(prompt).not.toContain("CHILD SECRET PROMPT");
});

test("buildMainAgentSystemPrompt keeps claude_code preset for coding profiles", () => {
  const codingProfile: EcoOrchestrationProfileConfig = {
    ...profile,
    id: "profile.coding",
    preset: "coding",
    mainAgent: {
      ...profile.mainAgent,
      domain: "coding",
      systemPromptPreset: "claude_code",
    },
  };

  const systemPrompt = buildMainAgentSystemPrompt(codingProfile, [researchTemplate], "CODING PHASE APPEND", {
    excludeDynamicSections: true,
  }) as Record<string, unknown>;

  expect(systemPrompt).toMatchObject({
    type: "preset",
    preset: "claude_code",
    excludeDynamicSections: true,
  });
  expect(systemPrompt.append).toContain("CODING PHASE APPEND");
  expect(systemPrompt.append).toContain("Agent(eco_researcher)");
});

test("resolveMainAgentAllowedTools uses profile tools for universal profiles and merges coding tools", () => {
  expect(resolveMainAgentAllowedTools(profile, ["Bash", "Write"])).toEqual([
    "Agent",
    "Read",
    "WebSearch",
    "Skill",
    "mcp__sources__quote",
    "mcp__browser__*",
  ]);

  const codingProfile: EcoOrchestrationProfileConfig = { ...profile, preset: "coding" };
  expect(resolveMainAgentAllowedTools(codingProfile, ["Bash", "Write"])).toEqual([
    "Agent",
    "Read",
    "WebSearch",
    "Bash",
    "Write",
    "Skill",
    "mcp__sources__quote",
    "mcp__browser__*",
  ]);
});

test("buildToolPermissionPolicyFromProfile resolves main and dynamic agent tools", () => {
  const policy = buildToolPermissionPolicyFromProfile(profile, [researchTemplate], {
    agentKeys: ["eco_researcher"],
    mainAllowedTools: ["AskUserQuestion"],
  });

  expect(policy.main).toEqual({
    allowed: [
      "Agent",
      "Read",
      "WebSearch",
      "AskUserQuestion",
      "Skill",
      "mcp__sources__quote",
      "mcp__browser__*",
    ],
    disallowed: ["Write"],
  });
  expect(policy.agents).toEqual({
    eco_researcher: {
      allowed: ["Read", "WebSearch", "mcp__sources__*", "mcp__browser__*", "Skill"],
      disallowed: ["Bash", "Agent", "Task"],
    },
  });
});

test("buildToolPermissionPolicyFromProfile preserves structured tool policies", () => {
  const firstAgent = requireElement(profile.agents, 0, "agent");
  const structuredProfile: EcoOrchestrationProfileConfig = {
    ...profile,
    mainAgent: {
      ...profile.mainAgent,
      tools: {
        ...profile.mainAgent.tools,
        bash: { enabled: true, approval: "always", commandAllowlist: ["bun test"] },
        filesystem: { read: "workspace", write: "none" },
        network: { webSearch: false, webFetch: true },
      },
    },
    agents: [
      {
        ...firstAgent,
        tools: {
          ...firstAgent.tools,
          bash: { enabled: true, approval: "risky", commandDenylist: ["rm*"] },
          filesystem: { read: "workspace", write: "none" },
          network: { webSearch: true, webFetch: false },
        },
      },
    ],
  };

  const policy = buildToolPermissionPolicyFromProfile(structuredProfile, [researchTemplate]);

  expect(policy.main).toMatchObject({
    bash: { enabled: true, approval: "always", commandAllowlist: ["bun test"] },
    filesystem: { read: "workspace", write: "none" },
    network: { webSearch: false, webFetch: true },
  });
  expect(policy.agents.eco_researcher).toMatchObject({
    bash: { enabled: true, approval: "risky", commandDenylist: ["rm*"] },
    filesystem: { read: "workspace", write: "none" },
    network: { webSearch: true, webFetch: false },
  });
});

test("subagent delegation tools require allowDelegation", () => {
  const firstAgent = requireElement(profile.agents, 0, "agent");
  const delegatingProfile: EcoOrchestrationProfileConfig = {
    ...profile,
    agents: [
      {
        ...firstAgent,
        tools: toolPolicy(["Read", "Agent", "Task"], []),
      },
    ],
  };
  const blockedTemplate: EcoAgentTemplateConfig = {
    ...researchTemplate,
    defaultTools: toolPolicy(["Read", "Agent", "Task"], []),
    allowDelegation: false,
  };

  const blockedDefinitions = createAgentDefinitionsFromProfile(delegatingProfile, [blockedTemplate]);
  const blockedDefinition = blockedDefinitions.definitions.eco_researcher as Record<string, unknown>;
  expect(blockedDefinition.tools).toEqual(["Read", "mcp__sources__*", "mcp__browser__*", "Skill"]);
  expect(blockedDefinition.disallowedTools).toEqual(["Agent", "Task"]);

  const blockedPolicy = buildToolPermissionPolicyFromProfile(delegatingProfile, [blockedTemplate]);
  expect(blockedPolicy.agents.eco_researcher).toEqual({
    allowed: ["Read", "mcp__sources__*", "mcp__browser__*", "Skill"],
    disallowed: ["Agent", "Task"],
  });

  const allowedTemplate: EcoAgentTemplateConfig = { ...blockedTemplate, allowDelegation: true };
  const allowedDefinitions = createAgentDefinitionsFromProfile(delegatingProfile, [allowedTemplate]);
  const allowedDefinition = allowedDefinitions.definitions.eco_researcher as Record<string, unknown>;
  expect(allowedDefinition.tools).toEqual([
    "Read",
    "Agent",
    "Task",
    "mcp__sources__*",
    "mcp__browser__*",
    "Skill",
  ]);
  expect(allowedDefinition).not.toHaveProperty("disallowedTools");

  const allowedPolicy = buildToolPermissionPolicyFromProfile(delegatingProfile, [allowedTemplate]);
  expect(allowedPolicy.agents.eco_researcher).toEqual({
    allowed: ["Read", "Agent", "Task", "mcp__sources__*", "mcp__browser__*", "Skill"],
    disallowed: [],
  });
});

test("sdkAgentKeyForProfileAgent normalizes custom keys", () => {
  expect(sdkAgentKeyForProfileAgent(" Research Lead ")).toBe("eco_Research_Lead");
  expect(sdkAgentKeyForProfileAgent("eco_writer")).toBe("eco_writer");
  expect(() => sdkAgentKeyForProfileAgent("   ")).toThrow("Agent key cannot be empty.");
});
