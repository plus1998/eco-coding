import { expect, test } from "bun:test";
import {
  type AgentProfileFormState,
  agentProfileToForm,
  buildOrchestrationProfileFromForm,
  createBlankAgentProfileForm,
  createCopiedAgentProfileForm,
  createProfileAgentFormFromTemplate,
} from "../src/renderer/agent-profile-form";
import type { AgentTemplate, OrchestrationProfile, ProviderConfigView } from "../src/shared/ipc";
import { runtimeRoleRoutesFromAgentProfile } from "../src/shared/thread-runtime-config";

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
      modelRef: {
        providerId: provider.id,
        modelId: "model-main",
        candidateModelId: "cand-main",
      },
      tools: { allowed: ["Agent", "Read"], disallowed: ["Write"] },
      skills: [],
    },
    builtinAgents: {
      explore: {
        modelRef: {
          providerId: provider.id,
          modelId: "model-explore",
          candidateModelId: "cand-explore",
        },
      },
    },
    agents: [
      {
        agentKey: "researcher",
        templateId: researcherTemplate.id,
        displayName: "Researcher",
        modelRef: {
          providerId: provider.id,
          modelId: "model-research",
          candidateModelId: "cand-researcher",
        },
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

function withRequiredCandidateIds(form: AgentProfileFormState): AgentProfileFormState {
  form.mainCandidateModelId = form.mainCandidateModelId || "cand-main";
  form.builtinExploreCandidateModelId = form.builtinExploreCandidateModelId || "cand-explore";
  for (const agent of form.agents) {
    if (agent.enabled && !agent.candidateModelId) {
      agent.candidateModelId = `cand-${agent.agentKey}`;
    }
  }
  return form;
}

test("createBlankAgentProfileForm defaults the main agent to hands-on (write + bash)", () => {
  const form = createBlankAgentProfileForm({ providers: [provider] });
  withRequiredCandidateIds(form);

  expect(form.mainWriteCodebase).toBe(true);
  expect(form.mainBash).toBe(true);
  expect(form.mainAllowDelegation).toBe(true);
  expect(form.mainAdvancedDisallowedTools).toBe("");
  expect(form.mainSystemPromptPreset).toBe("claude_code");

  const built = buildOrchestrationProfileFromForm(form, {
    templates: [],
    nowIso: "2026-06-10T00:00:00.000Z",
  });
  expect(built.mainAgent.systemPromptPreset).toBe("claude_code");
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
  const form = withRequiredCandidateIds(agentProfileToForm(profile()));
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
  sourceVerifier.candidateModelId = "cand-source-verifier";

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
      modelRef: {
        providerId: provider.id,
        modelId: "model-main",
        candidateModelId: "cand-main",
      },
      skills: [],
    },
    builtinAgents: {
      explore: {
        modelRef: {
          providerId: provider.id,
          modelId: "model-explore-fast",
          candidateModelId: "cand-explore",
        },
      },
    },
  });
  expect(built.agents.map((agent) => agent.agentKey)).toEqual(["researcher", "source_verifier"]);
  expect(built.agents[1]?.tools.disallowed).toContain("Bash");
  expect(built.agents[1]?.tools.filesystem).toEqual({ read: "workspace", write: "none" });
  expect(built.strategy).toEqual({
    kind: "autonomous",
    guidancePrompt: "Delegate research only when it materially improves the answer.",
  });
});

test("buildOrchestrationProfileFromForm saves main and subagent capability policies", () => {
  const form = withRequiredCandidateIds(agentProfileToForm(profile()));
  form.id = "user.structured";
  form.mainWriteCodebase = false;
  form.mainNetwork = false;
  form.mainMcpServers = "docs";
  form.mainMcpTools = "mcp__docs__search";
  form.mainBashCommandAllowlist = "bun test";
  form.mainBashCommandDenylist = "rm*";
  form.agents[0]!.bash = false;

  const built = buildOrchestrationProfileFromForm(form, {
    existing: profile(),
    templates: [researcherTemplate],
  });

  expect(built.mainAgent.tools).toMatchObject({
    allowed: [],
    disallowed: expect.arrayContaining(["Write", "WebSearch", "WebFetch"]),
    bash: { enabled: true, commandAllowlist: ["bun test"], commandDenylist: ["rm*"] },
    mcp: { allowedServers: ["docs"], allowedTools: ["mcp__docs__search"] },
    filesystem: { read: "workspace", write: "none" },
    network: { webSearch: false, webFetch: false },
  });
  expect(built.agents[0]?.tools).toMatchObject({
    disallowed: expect.arrayContaining(["Bash"]),
    filesystem: { read: "workspace", write: "none" },
    network: { webSearch: true, webFetch: true },
  });
  expect(built.agents[0]?.mcpServers).toEqual(["docs"]);
  expect(built.agents[0]?.skills).toEqual([]);
});

test("buildOrchestrationProfileFromForm rejects reserved and duplicate agent keys", () => {
  const form = withRequiredCandidateIds(agentProfileToForm(profile()));
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

test("buildOrchestrationProfileFromForm only stores candidate references", () => {
  const form = withRequiredCandidateIds(agentProfileToForm(profile()));
  form.mainCandidateModelId = "cand-main";
  form.builtinExploreCandidateModelId = "cand-explore";
  form.agents[0]!.candidateModelId = "cand-researcher";

  const built = buildOrchestrationProfileFromForm(form, {
    existing: profile(),
    templates: [researcherTemplate],
  });

  expect(built.mainAgent.modelRef.candidateModelId).toBe("cand-main");
  expect(built.mainAgent.modelRef.modelsDevMapping).toBeUndefined();
  expect(built.mainAgent.modelRef.manualSpec).toBeUndefined();
  expect(built.builtinAgents.explore.modelRef.candidateModelId).toBe("cand-explore");
  expect(built.agents[0]?.modelRef.candidateModelId).toBe("cand-researcher");

  const routes = runtimeRoleRoutesFromAgentProfile(built);
  expect(routes.find((route) => route.role === "planner")?.candidateModelId).toBe("cand-main");
});

test("buildOrchestrationProfileFromForm requires candidate model selection", () => {
  const form = agentProfileToForm(profile());
  form.mainCandidateModelId = "";

  expect(() =>
    buildOrchestrationProfileFromForm(form, { existing: profile(), templates: [researcherTemplate] }),
  ).toThrow("主 Agent 必须选择候选模型。");
});

test("agentProfileToForm round-trips apiCompat for main, explore, and subagents", () => {
  const source = profile();
  source.mainAgent.modelRef.apiCompat = "anthropic";
  source.builtinAgents.explore.modelRef.apiCompat = "openai_chat_completions";
  source.agents[0]!.modelRef.apiCompat = "openai_responses";

  const form = agentProfileToForm(source);
  expect(form.mainApiCompat).toBe("anthropic");
  expect(form.builtinExploreApiCompat).toBe("openai_chat_completions");
  expect(form.agents[0]?.apiCompat).toBe("openai_responses");

  form.name = "Research Profile Updated";
  const built = buildOrchestrationProfileFromForm(form, {
    existing: source,
    templates: [researcherTemplate],
  });

  expect(built.mainAgent.modelRef.apiCompat).toBe("anthropic");
  expect(built.builtinAgents.explore.modelRef.apiCompat).toBe("openai_chat_completions");
  expect(built.agents[0]?.modelRef.apiCompat).toBe("openai_responses");

  const routes = runtimeRoleRoutesFromAgentProfile(built);
  expect(routes.find((route) => route.role === "planner")?.apiCompat).toBe("anthropic");
  expect(routes.find((route) => route.role === "explore")?.apiCompat).toBe("openai_chat_completions");
  expect(routes.find((route) => route.role === "researcher")?.apiCompat).toBe("openai_responses");
});

test("buildOrchestrationProfileFromForm omits apiCompat when left at default", () => {
  const form = withRequiredCandidateIds(agentProfileToForm(profile()));
  form.mainApiCompat = "";
  form.builtinExploreApiCompat = "";
  form.agents[0]!.apiCompat = "";

  const built = buildOrchestrationProfileFromForm(form, {
    existing: profile(),
    templates: [researcherTemplate],
  });

  expect(built.mainAgent.modelRef.apiCompat).toBeUndefined();
  expect(built.builtinAgents.explore.modelRef.apiCompat).toBeUndefined();
  expect(built.agents[0]?.modelRef.apiCompat).toBeUndefined();
});
