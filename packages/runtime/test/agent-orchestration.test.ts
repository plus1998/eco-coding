import { expect, test } from "bun:test";
import {
  buildMainAgentSystemPrompt,
  buildBuiltinPlanToolPermissionEntry,
  buildToolPermissionPolicyFromProfile,
  createAgentDefinitionsFromProfile,
  type EcoAgentTemplateConfig,
  type EcoOrchestrationProfileConfig,
  type EcoToolPolicy,
  resolveMainAgentAllowedTools,
  resolveMainAgentHandsOnCapability,
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
    tools: ["Read", "WebSearch", "LS", "NotebookRead"],
    disallowedTools: ["Bash", "Agent", "Task", "TaskList", "TaskOutput"],
    prompt: researchTemplate.prompt,
    mcpServers: ["sources", "browser"],
  });
  expect(definition.description).toContain("Evidence Researcher");
  expect(definition.description).toContain("Use when: Need sourced findings or external context");
});

test("createAgentDefinitionsFromProfile merges dynamic session skills", () => {
  const resolved = createAgentDefinitionsFromProfile(profile, [researchTemplate], {
    agentSkills: { eco_researcher: ["workspace-research"] },
  });

  const definition = resolved.definitions.eco_researcher as Record<string, unknown>;
  expect(definition.skills).toEqual(["workspace-research"]);
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

test("resolveMainAgentHandsOnCapability mirrors the main agent tool policy enforcement", () => {
  expect(resolveMainAgentHandsOnCapability(undefined)).toEqual({
    canEditFiles: true,
    canRunBash: true,
  });

  const restricted: EcoOrchestrationProfileConfig = {
    ...profile,
    mainAgent: {
      ...profile.mainAgent,
      tools: {
        allowed: ["Agent", "Read"],
        disallowed: [],
        filesystem: { read: "workspace", write: "none" },
      },
    },
  };
  expect(resolveMainAgentHandsOnCapability(restricted)).toEqual({
    canEditFiles: false,
    canRunBash: false,
  });

  const handsOn: EcoOrchestrationProfileConfig = {
    ...profile,
    mainAgent: {
      ...profile.mainAgent,
      tools: {
        allowed: ["Agent", "Read", "Write", "Edit", "Bash"],
        disallowed: [],
        bash: { enabled: true },
        filesystem: { read: "workspace", write: "workspace" },
      },
    },
  };
  expect(resolveMainAgentHandsOnCapability(handsOn)).toEqual({
    canEditFiles: true,
    canRunBash: true,
  });

  const disallowedWrites: EcoOrchestrationProfileConfig = {
    ...profile,
    mainAgent: {
      ...profile.mainAgent,
      tools: {
        allowed: ["Agent", "Read"],
        disallowed: ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"],
        bash: { enabled: true },
        filesystem: { read: "workspace", write: "workspace" },
      },
    },
  };
  expect(resolveMainAgentHandsOnCapability(disallowedWrites)).toEqual({
    canEditFiles: false,
    canRunBash: false,
  });
});

test("resolveMainAgentAllowedTools merges phase tools for universal profiles", () => {
  expect(resolveMainAgentAllowedTools(profile, ["Bash", "Write"])).toEqual([
    "Bash",
    "Write",
    "Skill",
    "TaskCreate",
    "TaskUpdate",
    "TodoWrite",
    "MultiEdit",
    "NotebookEdit",
    "Agent",
    "Read",
    "WebSearch",
    "LS",
    "NotebookRead",
    "TaskList",
    "TaskOutput",
    "mcp__browser__*",
    "mcp__sources__*",
  ]);

  const planningPhaseTools = [
    "Agent",
    "Read",
    "Glob",
    "Grep",
    "WebSearch",
    "WebFetch",
    "AskUserQuestion",
  ];
  const planningResolved = resolveMainAgentAllowedTools(profile, planningPhaseTools);
  expect(planningResolved).not.toContain("ExitPlanMode");
  expect(planningResolved).toContain("AskUserQuestion");
  expect(planningResolved).not.toContain("Bash");

  const codingProfile: EcoOrchestrationProfileConfig = { ...profile, preset: "coding" };
  const executionPhaseTools = [
    "Agent",
    "Read",
    "Glob",
    "Grep",
    "Write",
    "Edit",
    "Bash",
    "WebSearch",
    "WebFetch",
  ];
  expect(resolveMainAgentAllowedTools(codingProfile, executionPhaseTools)).toEqual([
    "Agent",
    "Read",
    "Glob",
    "Grep",
    "Write",
    "Edit",
    "Bash",
    "WebSearch",
    "WebFetch",
    "Skill",
    "TaskCreate",
    "TaskUpdate",
    "TodoWrite",
    "LS",
    "NotebookRead",
    "MultiEdit",
    "NotebookEdit",
    "TaskList",
    "TaskOutput",
    "mcp__browser__*",
    "mcp__sources__*",
  ]);
});

test("resolveMainAgentAllowedTools caps coding profile tools to planning phase", () => {
  const codingProfile: EcoOrchestrationProfileConfig = {
    ...profile,
    preset: "coding",
    mainAgent: {
      ...profile.mainAgent,
      tools: {
        allowed: ["Agent", "Read", "Write", "Edit", "Bash", "WebSearch", "WebFetch"],
        disallowed: [],
        bash: { enabled: true },
        filesystem: { read: "workspace", write: "workspace" },
        network: { webSearch: true, webFetch: true },
      },
    },
  };
  const planningPhaseTools = [
    "Agent",
    "Read",
    "Glob",
    "Grep",
    "WebSearch",
    "WebFetch",
    "AskUserQuestion",
  ];
  const resolved = resolveMainAgentAllowedTools(codingProfile, planningPhaseTools);
  expect(resolved).not.toContain("ExitPlanMode");
  expect(resolved).toContain("AskUserQuestion");
  expect(resolved).toContain("Read");
  expect(resolved).not.toContain("Write");
  expect(resolved).not.toContain("Edit");
  expect(resolved).not.toContain("MultiEdit");
  expect(resolved).not.toContain("Bash");
});

test("buildBuiltinPlanToolPermissionEntry keeps plan agent read-only with network access", () => {
  const entry = buildBuiltinPlanToolPermissionEntry();
  expect(entry.disallowed).toContain("Write");
  expect(entry.disallowed).toContain("Bash");
  expect(entry.allowed).toEqual([]);
  expect(entry.filesystem).toEqual({ read: "workspace", write: "none" });
  expect(entry.network).toEqual({ webSearch: true, webFetch: true });
});

test("buildToolPermissionPolicyFromProfile enables bash for hands-on profiles without explicit bash field", () => {
  const handsOnProfile: EcoOrchestrationProfileConfig = {
    ...profile,
    preset: "coding",
    mainAgent: {
      ...profile.mainAgent,
      tools: {
        allowed: [],
        disallowed: [],
        filesystem: { read: "workspace", write: "workspace" },
        network: { webSearch: true, webFetch: true },
      },
    },
  };
  const mainAllowedTools = resolveMainAgentAllowedTools(handsOnProfile, [
    "Agent",
    "Read",
    "Glob",
    "Grep",
    "Write",
    "Edit",
    "Bash",
    "WebSearch",
    "WebFetch",
  ]);
  const policy = buildToolPermissionPolicyFromProfile(handsOnProfile, [researchTemplate], {
    mainAllowedTools,
  });
  expect(policy.main.bash?.enabled).toBe(true);
});

test("buildToolPermissionPolicyFromProfile enables bash for legacy allowed Bash during execution", () => {
  const legacyCodingProfile: EcoOrchestrationProfileConfig = {
    ...profile,
    preset: "coding",
    mainAgent: {
      ...profile.mainAgent,
      tools: {
        allowed: ["Agent", "Read", "Write", "Edit", "Bash", "WebSearch", "WebFetch"],
        disallowed: [],
        filesystem: { read: "workspace", write: "workspace" },
        network: { webSearch: true, webFetch: true },
      },
    },
  };
  const mainAllowedTools = resolveMainAgentAllowedTools(legacyCodingProfile, [
    "Agent",
    "Read",
    "Glob",
    "Grep",
    "Write",
    "Edit",
    "Bash",
    "WebSearch",
    "WebFetch",
  ]);
  const policy = buildToolPermissionPolicyFromProfile(legacyCodingProfile, [researchTemplate], {
    mainAllowedTools,
  });
  expect(policy.main.bash?.enabled).toBe(true);
});

test("buildToolPermissionPolicyFromProfile disables main writes during planning phase", () => {
  const codingProfile: EcoOrchestrationProfileConfig = {
    ...profile,
    preset: "coding",
    mainAgent: {
      ...profile.mainAgent,
      tools: {
        allowed: ["Agent", "Read", "Write", "Edit", "Bash", "WebSearch", "WebFetch"],
        disallowed: [],
        bash: { enabled: true },
        filesystem: { read: "workspace", write: "workspace" },
        network: { webSearch: true, webFetch: true },
      },
    },
  };
  const mainAllowedTools = resolveMainAgentAllowedTools(codingProfile, [
    "Agent",
    "Read",
    "Glob",
    "Grep",
    "WebSearch",
    "WebFetch",
    "AskUserQuestion",
  ]);
  const policy = buildToolPermissionPolicyFromProfile(codingProfile, [researchTemplate], {
    mainAllowedTools,
  });
  expect(policy.main.allowed).not.toContain("ExitPlanMode");
  expect(policy.main.allowed).not.toContain("Write");
  expect(policy.main.filesystem).toEqual({ read: "workspace", write: "none" });
  expect(policy.main.bash?.enabled).toBe(false);
});

test("buildToolPermissionPolicyFromProfile caps universal profile tools during planning phase", () => {
  const mainAllowedTools = resolveMainAgentAllowedTools(profile, [
    "Agent",
    "Read",
    "Glob",
    "Grep",
    "WebSearch",
    "WebFetch",
    "AskUserQuestion",
  ]);
  const policy = buildToolPermissionPolicyFromProfile(profile, [researchTemplate], {
    mainAllowedTools,
  });
  expect(policy.main.allowed).not.toContain("ExitPlanMode");
  expect(policy.main.allowed).not.toContain("Write");
});

test("buildToolPermissionPolicyFromProfile resolves main and dynamic agent tools", () => {
  const mainAllowedTools = resolveMainAgentAllowedTools(profile, [
    "Agent",
    "TaskList",
    "TaskOutput",
    "Skill",
    "Read",
    "Glob",
    "Grep",
    "LS",
    "NotebookRead",
    "WebSearch",
    "WebFetch",
    "AskUserQuestion",
  ]);
  const policy = buildToolPermissionPolicyFromProfile(profile, [researchTemplate], {
    agentKeys: ["eco_researcher"],
    mainAllowedTools,
  });

  expect(policy.main.allowed).toEqual(
    expect.arrayContaining(["Skill", "TaskCreate", "TaskUpdate", "TodoWrite"]),
  );
  expect(policy.main.mcpServers).toEqual(["browser", "sources"]);
  expect(policy.main).toMatchObject({
    disallowed: ["Write"],
    filesystem: { read: "workspace", write: "none" },
  });
  expect(policy.agents.eco_researcher).toMatchObject({
    allowed: ["Read", "WebSearch", "Skill", "LS", "NotebookRead"],
    disallowed: ["Bash", "Agent", "Task", "TaskList", "TaskOutput"],
    mcpServers: ["sources", "browser"],
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
        bash: { enabled: true, commandAllowlist: ["bun test"] },
        filesystem: { read: "workspace", write: "none" },
        network: { webSearch: false, webFetch: true },
      },
    },
    agents: [
      {
        ...firstAgent,
        tools: {
          ...firstAgent.tools,
          disallowed: firstAgent.tools.disallowed.filter((tool) => tool !== "Bash"),
          bash: { enabled: true, commandDenylist: ["rm*"] },
          filesystem: { read: "workspace", write: "none" },
          network: { webSearch: true, webFetch: false },
        },
      },
    ],
  };

  const policy = buildToolPermissionPolicyFromProfile(structuredProfile, [researchTemplate]);

  expect(policy.main).toMatchObject({
    bash: { enabled: true, commandAllowlist: ["bun test"] },
    filesystem: { read: "workspace", write: "none" },
    network: { webSearch: false, webFetch: true },
  });
  expect(policy.agents.eco_researcher).toMatchObject({
    bash: { enabled: true, commandDenylist: ["rm*"] },
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
  expect(blockedDefinition.tools).toEqual(["Read", "LS", "NotebookRead"]);
  expect(blockedDefinition.mcpServers).toEqual(["sources", "browser"]);
  expect(blockedDefinition.disallowedTools).toEqual(["Agent", "Task", "TaskList", "TaskOutput"]);

  const blockedPolicy = buildToolPermissionPolicyFromProfile(delegatingProfile, [blockedTemplate]);
  expect(blockedPolicy.agents.eco_researcher).toMatchObject({
    allowed: ["Read", "Skill", "LS", "NotebookRead"],
    disallowed: ["Agent", "Task", "TaskList", "TaskOutput"],
    mcpServers: ["sources", "browser"],
  });

  const allowedTemplate: EcoAgentTemplateConfig = { ...blockedTemplate, allowDelegation: true };
  const allowedDefinitions = createAgentDefinitionsFromProfile(delegatingProfile, [allowedTemplate]);
  const allowedDefinition = allowedDefinitions.definitions.eco_researcher as Record<string, unknown>;
  expect(allowedDefinition.tools).toEqual([
    "Read",
    "Agent",
    "Task",
    "LS",
    "NotebookRead",
    "TaskList",
    "TaskOutput",
  ]);
  expect(allowedDefinition.mcpServers).toEqual(["sources", "browser"]);
  expect(allowedDefinition).not.toHaveProperty("disallowedTools");

  const allowedPolicy = buildToolPermissionPolicyFromProfile(delegatingProfile, [allowedTemplate]);
  expect(allowedPolicy.agents.eco_researcher).toMatchObject({
    allowed: ["Read", "Agent", "Task", "Skill", "LS", "NotebookRead", "TaskList", "TaskOutput"],
    disallowed: [],
    mcpServers: ["sources", "browser"],
  });
});

test("sdkAgentKeyForProfileAgent normalizes custom keys", () => {
  expect(sdkAgentKeyForProfileAgent(" Research Lead ")).toBe("eco_Research_Lead");
  expect(sdkAgentKeyForProfileAgent("eco_writer")).toBe("eco_writer");
  expect(() => sdkAgentKeyForProfileAgent("   ")).toThrow("Agent key cannot be empty.");
});
