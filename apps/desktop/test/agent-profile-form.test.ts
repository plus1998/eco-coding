import { expect, test } from "bun:test";
import {
  agentProfileToForm,
  buildOrchestrationProfileFromForm,
  createBlankAgentProfileForm,
  createCopiedAgentProfileForm,
  createProfileAgentFormFromTemplate,
} from "../src/renderer/agent-profile-form";
import type { AgentTemplate, OrchestrationProfile, ProviderConfigView } from "../src/shared/ipc";

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

const researcherTemplate: AgentTemplate = {
  id: "builtin.research.researcher",
  name: "Researcher",
  description: "Research agent",
  domain: "research",
  prompt: "Research.",
  whenToUse: "Use for research.",
  defaultTools: {
    allowed: ["Read", "WebSearch"],
    disallowed: ["Bash"],
    filesystem: { read: "workspace", write: "none" },
    network: { webSearch: true, webFetch: false },
  },
  mcpServers: ["docs"],
  skills: ["citations"],
  allowDelegation: false,
  builtIn: true,
  source: "built_in",
  version: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function profile(): OrchestrationProfile {
  return {
    id: "derived.research",
    name: "Research Profile",
    preset: "research",
    mainAgent: {
      agentKey: "main",
      name: "Research Main",
      domain: "research",
      systemPromptPreset: "custom",
      prompt: "Coordinate research.",
      modelRef: { providerId: provider.id, modelId: "model-main" },
      tools: { allowed: ["Agent", "Read"], disallowed: ["Write"] },
      skills: [],
    },
    builtinAgents: {
      explore: {
        modelRef: { providerId: provider.id, modelId: "model-explore" },
      },
    },
    agents: [
      {
        agentKey: "researcher",
        templateId: researcherTemplate.id,
        displayName: "Researcher",
        modelRef: { providerId: provider.id, modelId: "model-research" },
        tools: researcherTemplate.defaultTools,
        mcpServers: ["docs"],
        skills: ["citations"],
        enabled: true,
      },
    ],
    strategy: {
      kind: "autonomous",
      guidancePrompt: "Use the researcher when evidence quality matters.",
    },
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "derived",
  };
}

function requireElement<T>(values: readonly T[], index: number, label: string): T {
  const value = values[index];
  if (!value) {
    throw new Error(`${label} ${index} missing in test fixture.`);
  }
  return value;
}

test("createBlankAgentProfileForm defaults the main agent to hands-on (write + bash)", () => {
  const form = createBlankAgentProfileForm({ providers: [provider] });

  expect(form.mainFilesystemWrite).toBe("workspace");
  expect(form.mainDisallowedTools).toBe("");

  const built = buildOrchestrationProfileFromForm(form, {
    templates: [],
    nowIso: "2026-06-10T00:00:00.000Z",
  });
  expect(built.mainAgent.tools.allowed).toEqual([]);
  expect(built.mainAgent.tools.filesystem).toEqual({ read: "workspace", write: "workspace" });
  expect(built.mainAgent.tools.bash).toMatchObject({ enabled: true });
  expect(built.mainAgent.skills).toEqual([]);
});

test("createCopiedAgentProfileForm turns protected profiles into user-editable copies", () => {
  const form = createCopiedAgentProfileForm(profile(), {
    existingIds: ["user.research"],
    existingNames: ["Research Profile Copy"],
  });

  expect(form.id).toBe("user.research_2");
  expect(form.name).toBe("Research Profile Copy 2");
  expect(form.source).toBe("user");
  expect(form.agents[0]?.agentKey).toBe("researcher");
});

test("buildOrchestrationProfileFromForm binds models and preserves guidance", () => {
  const form = agentProfileToForm(profile());
  form.id = "user.research";
  form.source = "project";
  form.builtinExploreModelId = "model-explore-fast";
  form.guidancePrompt = "Delegate research only when it materially improves the answer.";
  form.agents.push(
    createProfileAgentFormFromTemplate(researcherTemplate, {
      provider,
      existingAgentKeys: form.agents.map((agent) => agent.agentKey),
    }),
  );
  const sourceVerifier = requireElement(form.agents, 1, "agent");
  sourceVerifier.agentKey = "source_verifier";
  sourceVerifier.displayName = "Source Verifier";

  const built = buildOrchestrationProfileFromForm(form, {
    existing: profile(),
    templates: [researcherTemplate],
    nowIso: "2026-06-08T00:00:00.000Z",
  });

  expect(built).toMatchObject({
    id: "user.research",
    source: "project",
    updatedAt: "2026-06-08T00:00:00.000Z",
    mainAgent: {
      modelRef: { providerId: provider.id, modelId: "model-main" },
      skills: [],
    },
    builtinAgents: {
      explore: {
        modelRef: { providerId: provider.id, modelId: "model-explore-fast" },
      },
    },
  });
  expect(built.agents.map((agent) => agent.agentKey)).toEqual(["researcher", "source_verifier"]);
  expect(built.agents[1]?.tools.allowed).toEqual(["Read", "WebSearch"]);
  expect(built.agents[1]?.tools.filesystem).toEqual({ read: "workspace", write: "none" });
  expect(built.strategy).toEqual({
    kind: "autonomous",
    guidancePrompt: "Delegate research only when it materially improves the answer.",
  });
});

test("buildOrchestrationProfileFromForm saves main tools but uses source subagent policies", () => {
  const form = agentProfileToForm(profile());
  form.id = "user.structured";
  form.mainDisallowedTools = "Write, WebSearch";
  form.mainMcpServers = "docs";
  form.mainMcpTools = "mcp__docs__search";
  form.mainBashCommandAllowlist = "bun test";
  form.mainBashCommandDenylist = "rm*";
  form.mainFilesystemRead = "workspace";
  form.mainFilesystemWrite = "none";

  const built = buildOrchestrationProfileFromForm(form, {
    existing: profile(),
    templates: [researcherTemplate],
  });

  expect(built.mainAgent.tools).toMatchObject({
    allowed: [],
    disallowed: ["Write", "WebSearch"],
    bash: { enabled: true, commandAllowlist: ["bun test"], commandDenylist: ["rm*"] },
    mcp: { allowedServers: ["docs"], allowedTools: ["mcp__docs__search"] },
    filesystem: { read: "workspace", write: "none" },
    network: { webSearch: false, webFetch: true },
  });
  expect(built.agents[0]?.tools).toMatchObject({
    allowed: ["Read", "WebSearch"],
    disallowed: ["Bash"],
    filesystem: { read: "workspace", write: "none" },
    network: { webSearch: true, webFetch: false },
  });
  expect(built.agents[0]?.mcpServers).toEqual(["docs"]);
  expect(built.agents[0]?.skills).toEqual([]);
});

test("buildOrchestrationProfileFromForm rejects reserved and duplicate agent keys", () => {
  const form = agentProfileToForm(profile());
  form.id = "user.bad";
  const firstAgent = requireElement(form.agents, 0, "agent");
  firstAgent.agentKey = "system";

  expect(() =>
    buildOrchestrationProfileFromForm(form, { existing: profile(), templates: [researcherTemplate] }),
  ).toThrow("系统保留名称");

  firstAgent.agentKey = "researcher";
  form.agents.push({ ...firstAgent });
  expect(() =>
    buildOrchestrationProfileFromForm(form, { existing: profile(), templates: [researcherTemplate] }),
  ).toThrow("Agent key 重复");
});

test("buildOrchestrationProfileFromForm persists manual context limits for main, explore, and subagents", () => {
  const source = profile();
  source.mainAgent.modelRef.manualSpec = { contextTokens: 200_000, inputPerM: 3, outputPerM: 15 };
  source.builtinAgents.explore.modelRef.manualSpec = { contextTokens: 128_000 };
  source.agents[0]!.modelRef.manualSpec = { contextTokens: 64_000 };

  const form = agentProfileToForm(source);
  expect(form.mainManualContextTokens).toBe("200000");
  expect(form.builtinExploreManualContextTokens).toBe("128000");
  expect(form.agents[0]?.manualContextTokens).toBe("64000");

  form.mainManualContextTokens = "256,000";
  form.builtinExploreManualContextTokens = "";
  form.agents[0]!.manualContextTokens = "100000";

  const built = buildOrchestrationProfileFromForm(form, {
    existing: source,
    templates: [researcherTemplate],
  });

  expect(built.mainAgent.modelRef.manualSpec).toEqual({
    contextTokens: 256_000,
    inputPerM: 3,
    outputPerM: 15,
  });
  expect(built.builtinAgents.explore.modelRef.manualSpec).toBeUndefined();
  expect(built.agents[0]?.modelRef.manualSpec).toEqual({ contextTokens: 100_000 });
});

test("buildOrchestrationProfileFromForm rejects invalid manual context limits", () => {
  const form = agentProfileToForm(profile());
  form.mainManualContextTokens = "abc";

  expect(() =>
    buildOrchestrationProfileFromForm(form, { existing: profile(), templates: [researcherTemplate] }),
  ).toThrow("手动上下文上限必须是正整数");
});
