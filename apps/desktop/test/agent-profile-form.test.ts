import { expect, test } from "bun:test";
import {
  agentProfileToForm,
  buildOrchestrationProfileFromForm,
  createCopiedAgentProfileForm,
  createProfileAgentFormFromTemplate,
  createProfileWorkflowStepFormFromAgent,
  createWorkflowStepFormsFromAgents,
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
      kind: "fixed",
      steps: [
        {
          id: "research",
          agentKey: "researcher",
          promptTemplate: "Research {{userPrompt}}.",
          dependsOn: [],
          runMode: "sequential",
          required: true,
          outputKey: "research_notes",
          failurePolicy: "stop",
        },
      ],
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

test("buildOrchestrationProfileFromForm preserves tools and builds fixed steps from agent order", () => {
  const form = agentProfileToForm(profile());
  form.id = "user.research";
  form.source = "project";
  form.mainSkills = "planning, citations";
  form.agents.push(
    createProfileAgentFormFromTemplate(researcherTemplate, {
      provider,
      existingAgentKeys: form.agents.map((agent) => agent.agentKey),
    }),
  );
  const sourceVerifier = requireElement(form.agents, 1, "agent");
  sourceVerifier.agentKey = "source_verifier";
  sourceVerifier.displayName = "Source Verifier";
  sourceVerifier.allowedTools = "Read, WebFetch";
  form.workflowSteps = createWorkflowStepFormsFromAgents(form.agents, form.workflowSteps);

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
      skills: ["planning", "citations"],
    },
  });
  expect(built.agents.map((agent) => agent.agentKey)).toEqual(["researcher", "source_verifier"]);
  expect(built.agents[1]?.tools.allowed).toEqual(["Read", "WebFetch"]);
  expect(built.agents[1]?.tools.filesystem).toEqual({ read: "workspace", write: "none" });
  expect(built.strategy).toMatchObject({
    kind: "fixed",
    steps: [
      { id: "research", agentKey: "researcher", outputKey: "research_notes" },
      { id: "source_verifier", agentKey: "source_verifier", dependsOn: ["research"] },
    ],
  });
});

test("buildOrchestrationProfileFromForm preserves edited fixed workflow steps", () => {
  const form = agentProfileToForm(profile());
  form.id = "user.research";
  const firstStep = requireElement(form.workflowSteps, 0, "workflow step");
  form.workflowSteps[0] = {
    ...firstStep,
    id: "collect_sources",
    promptTemplate: "Collect sources for {{userPrompt}} and return citations.",
    runMode: "parallel",
    required: false,
    outputKey: "sources",
    failurePolicy: "retry",
  };

  const built = buildOrchestrationProfileFromForm(form, {
    existing: profile(),
    templates: [researcherTemplate],
    nowIso: "2026-06-08T00:00:00.000Z",
  });

  expect(built.strategy).toEqual({
    kind: "fixed",
    steps: [
      {
        id: "collect_sources",
        agentKey: "researcher",
        promptTemplate: "Collect sources for {{userPrompt}} and return citations.",
        dependsOn: [],
        runMode: "parallel",
        required: false,
        outputKey: "sources",
        failurePolicy: "retry",
      },
    ],
  });
});

test("buildOrchestrationProfileFromForm saves structured tool policy fields", () => {
  const form = agentProfileToForm(profile());
  form.id = "user.structured";
  form.mainAllowedTools = "Agent, Bash, WebFetch";
  form.mainDisallowedTools = "Write";
  form.mainMcpServers = "docs";
  form.mainMcpTools = "mcp__docs__search";
  form.mainBashApproval = "always";
  form.mainBashCommandAllowlist = "bun test";
  form.mainBashCommandDenylist = "rm*";
  form.mainFilesystemRead = "workspace";
  form.mainFilesystemWrite = "none";
  form.mainNetworkWebSearch = false;
  form.mainNetworkWebFetch = true;
  const firstAgent = requireElement(form.agents, 0, "agent");
  firstAgent.allowedTools = "Read, WebSearch, Bash";
  firstAgent.disallowedTools = "Write";
  firstAgent.mcpServers = "browser";
  firstAgent.mcpTools = "mcp__browser__open";
  firstAgent.bashApproval = "never";
  firstAgent.bashCommandDenylist = "curl *";
  firstAgent.filesystemWrite = "none";
  firstAgent.networkWebFetch = false;

  const built = buildOrchestrationProfileFromForm(form, {
    existing: profile(),
    templates: [researcherTemplate],
  });

  expect(built.mainAgent.tools).toMatchObject({
    allowed: ["Agent", "Bash", "WebFetch"],
    disallowed: ["Write"],
    bash: { enabled: true, approval: "always", commandAllowlist: ["bun test"], commandDenylist: ["rm*"] },
    mcp: { allowedServers: ["docs"], allowedTools: ["mcp__docs__search"] },
    filesystem: { read: "workspace", write: "none" },
    network: { webSearch: false, webFetch: true },
  });
  expect(built.agents[0]?.tools).toMatchObject({
    allowed: ["Read", "WebSearch", "Bash"],
    bash: { enabled: true, approval: "never", commandDenylist: ["curl *"] },
    mcp: { allowedServers: ["browser"], allowedTools: ["mcp__browser__open"] },
    filesystem: { read: "workspace", write: "none" },
    network: { webSearch: true, webFetch: false },
  });
});

test("createWorkflowStepFormsFromAgents reuses existing steps and chains new agents", () => {
  const form = agentProfileToForm(profile());
  form.agents.push(
    createProfileAgentFormFromTemplate(researcherTemplate, {
      provider,
      existingAgentKeys: form.agents.map((agent) => agent.agentKey),
    }),
  );
  const sourceVerifier = requireElement(form.agents, 1, "agent");
  sourceVerifier.agentKey = "source_verifier";
  sourceVerifier.displayName = "Source Verifier";

  const steps = createWorkflowStepFormsFromAgents(form.agents, form.workflowSteps);

  expect(steps).toEqual([
    expect.objectContaining({ id: "research", agentKey: "researcher", outputKey: "research_notes" }),
    expect.objectContaining({
      id: "source_verifier",
      agentKey: "source_verifier",
      dependsOn: "research",
      outputKey: "source_verifier_output",
    }),
  ]);
});

test("createProfileWorkflowStepFormFromAgent creates unique workflow step defaults", () => {
  const step = createProfileWorkflowStepFormFromAgent(
    { agentKey: "researcher", displayName: "Researcher" },
    { existingStepIds: ["researcher"], previousStepId: "triage" },
  );

  expect(step).toMatchObject({
    id: "researcher_2",
    agentKey: "researcher",
    dependsOn: "triage",
    outputKey: "researcher_2_output",
    failurePolicy: "ask_user",
  });
});

test("buildOrchestrationProfileFromForm rejects invalid workflow steps", () => {
  const form = agentProfileToForm(profile());
  form.id = "user.bad.workflow";
  const firstStep = requireElement(form.workflowSteps, 0, "workflow step");
  form.workflowSteps[0] = { ...firstStep, dependsOn: "missing_step" };

  expect(() =>
    buildOrchestrationProfileFromForm(form, { existing: profile(), templates: [researcherTemplate] }),
  ).toThrow("依赖不存在");

  form.workflowSteps[0] = { ...firstStep, dependsOn: "", agentKey: "disabled_agent" };
  expect(() =>
    buildOrchestrationProfileFromForm(form, { existing: profile(), templates: [researcherTemplate] }),
  ).toThrow("未启用的 Agent");
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
