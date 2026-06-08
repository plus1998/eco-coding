import { expect, test } from "bun:test";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import {
  buildToolPermissionPolicyFromProfile,
  type EcoAgentRuntimeConfig,
  type EcoToolPolicy,
} from "../src/agent-orchestration";
import { createToolPermissionPreToolHook } from "../src/eco-sdk-hooks";

const noTools: EcoToolPolicy = {
  allowed: [],
  disallowed: [],
};

const registry: EcoAgentRuntimeConfig = {
  templates: [
    {
      id: "template.researcher",
      name: "Researcher",
      description: "Collects external evidence.",
      domain: "research",
      prompt: "Research with citations.",
      whenToUse: "Use for evidence gathering.",
      defaultTools: noTools,
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: false,
      source: "user",
      version: 1,
      updatedAt: "2026-06-08T00:00:00.000Z",
    },
    {
      id: "template.synthesizer",
      name: "Synthesizer",
      description: "Writes final synthesis.",
      domain: "research",
      prompt: "Synthesize prior outputs.",
      whenToUse: "Use for final answers.",
      defaultTools: noTools,
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: false,
      source: "user",
      version: 1,
      updatedAt: "2026-06-08T00:00:00.000Z",
    },
  ],
  profile: {
    id: "user.redteam.research",
    name: "Red Team Research",
    preset: "research",
    mainAgent: {
      agentKey: "main",
      name: "Research Lead",
      domain: "research",
      systemPromptPreset: "custom",
      prompt: "Coordinate safely.",
      modelRef: { providerId: "p1", modelId: "m1" },
      tools: {
        allowed: ["Agent", "Read", "Bash"],
        disallowed: [],
        bash: {
          enabled: true,
          approval: "risky",
          commandAllowlist: ["bun"],
          commandDenylist: ["rm*"],
        },
        mcp: { allowedServers: ["docs"], allowedTools: [] },
        filesystem: { read: "workspace", write: "none" },
        network: { webSearch: false, webFetch: false },
      },
      skills: [],
    },
    agents: [
      {
        agentKey: "researcher",
        templateId: "template.researcher",
        modelRef: { providerId: "p1", modelId: "m2" },
        tools: {
          allowed: ["WebSearch", "WebFetch"],
          disallowed: ["Bash"],
          mcp: { allowedServers: ["browser"], allowedTools: ["mcp__browser__snapshot"] },
          filesystem: { read: "none", write: "none" },
          network: { webSearch: true, webFetch: true },
        },
        mcpServers: [],
        skills: [],
        enabled: true,
      },
      {
        agentKey: "synthesizer",
        templateId: "template.synthesizer",
        modelRef: { providerId: "p1", modelId: "m3" },
        tools: {
          allowed: ["Read"],
          disallowed: ["Bash", "WebSearch", "WebFetch"],
          filesystem: { read: "workspace", write: "none" },
          network: { webSearch: false, webFetch: false },
        },
        mcpServers: [],
        skills: [],
        enabled: true,
      },
    ],
    strategy: {
      kind: "fixed",
      steps: [
        {
          id: "research",
          agentKey: "researcher",
          promptTemplate: "Gather sources.",
          dependsOn: [],
          runMode: "parallel",
          required: true,
          outputKey: "research_notes",
          failurePolicy: "stop",
        },
        {
          id: "synthesis",
          agentKey: "synthesizer",
          promptTemplate: "Synthesize notes.",
          dependsOn: ["research"],
          runMode: "sequential",
          required: true,
          outputKey: "brief",
          failurePolicy: "stop",
        },
      ],
    },
    version: 1,
    updatedAt: "2026-06-08T00:00:00.000Z",
    source: "user",
  },
};

type ExpectedDecision = "allow" | "ask" | "deny";

interface RedTeamCase {
  name: string;
  input: PreToolUseHookInput;
  expected: ExpectedDecision;
  reasonIncludes?: string;
}

test("Agent profile tool permission red-team suite covers main, subagent, and fixed-step actors", async () => {
  const decisions: Array<{ actor: string; toolName: string; reason: string }> = [];
  const hook = createToolPermissionPreToolHook(
    buildToolPermissionPolicyFromProfile(registry.profile, registry.templates),
    {
      workspacePath: "/workspace/project",
      onDecision(decision) {
        decisions.push({
          actor: decision.actor,
          toolName: decision.toolName,
          reason: decision.reason,
        });
      },
    },
  );
  expect(hook).toBeDefined();

  const cases: RedTeamCase[] = [
    {
      name: "main can read inside workspace",
      input: preTool("Read", { file_path: "/workspace/project/README.md" }),
      expected: "allow",
    },
    {
      name: "main cannot read outside workspace",
      input: preTool("Read", { file_path: "/workspace/secrets.env" }),
      expected: "deny",
      reasonIncludes: "outside",
    },
    {
      name: "main must ask before risky dependency install",
      input: preTool("Bash", { command: "bun install" }),
      expected: "ask",
      reasonIncludes: "Dependency changes require approval",
    },
    {
      name: "main denylist blocks destructive shell",
      input: preTool("Bash", { command: "rm -rf src" }),
      expected: "deny",
      reasonIncludes: "denylist",
    },
    {
      name: "main can call allowed MCP server",
      input: preTool("mcp__docs__search", { query: "policy" }),
      expected: "allow",
    },
    {
      name: "main cannot call another MCP server",
      input: preTool("mcp__slack__post", { text: "leak" }),
      expected: "deny",
      reasonIncludes: "not allowed",
    },
    {
      name: "researcher can search web",
      input: preTool("WebSearch", { query: "market" }, { agentType: "eco_researcher" }),
      expected: "allow",
    },
    {
      name: "researcher cannot use Bash even when prompt asks",
      input: preTool("Bash", { command: "curl https://example.com" }, { agentType: "eco_researcher" }),
      expected: "deny",
      reasonIncludes: "disallowed",
    },
    {
      name: "researcher cannot read local files",
      input: preTool("Read", { file_path: "/workspace/project/private.md" }, { agentType: "researcher" }),
      expected: "deny",
      reasonIncludes: "reads are disabled",
    },
    {
      name: "researcher can call explicit browser MCP tool",
      input: preTool("mcp__browser__snapshot", {}, { agentType: "eco_researcher" }),
      expected: "allow",
    },
    {
      name: "fixed synthesis step inherits synthesizer permissions",
      input: preTool(
        "WebSearch",
        { query: "should not search" },
        {
          agentType: "eco_synthesizer",
          workflowStep: {
            id: "synthesis",
            agentKey: "synthesizer",
            outputKey: "brief",
          },
        },
      ),
      expected: "deny",
      reasonIncludes: "disallowed",
    },
    {
      name: "fixed synthesis step can read workspace evidence",
      input: preTool(
        "Read",
        { file_path: "evidence.md" },
        {
          agentType: "synthesizer",
          workflowStep: {
            id: "synthesis",
            agentKey: "synthesizer",
            outputKey: "brief",
          },
        },
      ),
      expected: "allow",
    },
  ];

  for (const testCase of cases) {
    const result = await hook!(testCase.input, testCase.input.tool_use_id, {
      signal: new AbortController().signal,
    });
    const actual =
      result.hookSpecificOutput?.permissionDecision ??
      (result.hookSpecificOutput ? "allow" : "allow");
    expect(actual, testCase.name).toBe(testCase.expected);
    if (testCase.reasonIncludes) {
      expect(
        result.hookSpecificOutput?.permissionDecisionReason ?? "",
        testCase.name,
      ).toContain(testCase.reasonIncludes);
    }
  }

  expect(decisions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ actor: "main", toolName: "Read" }),
      expect.objectContaining({ actor: "main", toolName: "mcp__slack__post" }),
      expect.objectContaining({ actor: "eco_researcher", toolName: "Bash" }),
      expect.objectContaining({ actor: "researcher", toolName: "Read" }),
      expect.objectContaining({ actor: "eco_synthesizer", toolName: "WebSearch" }),
    ]),
  );
});

function preTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  options: {
    agentType?: string;
    workflowStep?: { id: string; agentKey: string; outputKey: string };
  } = {},
): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: {
      ...toolInput,
      ...(options.workflowStep && {
        ecoWorkflowStepContext: {
          ...options.workflowStep,
          profileId: registry.profile.id,
          attempt: 1,
        },
      }),
    },
    tool_use_id: `tool_${toolName}_${options.agentType ?? "main"}_${String(toolInput.command ?? toolInput.file_path ?? toolInput.query ?? "").length}`,
    session_id: "session_redteam",
    cwd: "/workspace/project",
    ...(options.agentType && {
      agent_id: `agent_${options.agentType}`,
      agent_type: options.agentType,
    }),
  };
}
