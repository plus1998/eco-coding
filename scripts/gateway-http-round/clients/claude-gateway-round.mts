/**
 * Full conversation-round scenario via Claude Code → Eco Bridge → Gateway.
 */
import fs from "node:fs";
import path from "node:path";
import type { AgentEvent } from "../../../packages/shared/src";
import type { EcoAgentRuntimeConfig } from "../../../packages/runtime/src/agent-orchestration";
import { ClaudeAgentSdkDriver } from "../../../packages/runtime/src/claude-agent-sdk";
import { buildScenarioPrompt } from "../../conversation-round/lib/scenario-prompt.mjs";
import {
  appendJsonl,
  ensureDir,
  redactSecrets,
  snapshotWorkspace,
  writeJson,
} from "../../conversation-round/lib/fixture-io.mjs";
import { evaluateSdkScenarioChecklist } from "../../conversation-round/lib/sdk-checklist.mjs";
import {
  resolveClaudeExecutable,
  resolveMcpEchoServerPath,
  resolveNodeExecutable,
} from "../../conversation-round/lib/resolve-executables.mjs";
import { setupScenarioWorkspace } from "../../conversation-round/lib/scenario-workspace.mjs";
import { FULL_ROUND_SCENARIO_ID } from "../lib/client-matrix.mjs";
import {
  resolveProfileApiCompat,
  resolveProfileModelAlias,
  type GatewayRecordingStack,
} from "../lib/gateway-stack.mts";
import { resolveProfile } from "../lib/profiles.mjs";

const GATEWAY_LOCAL_CLIENT_KEY = "gateway-local";

export interface ClaudeGatewayRoundInput {
  stack: GatewayRecordingStack;
  profileId: string;
  outDir: string;
  marker: string;
  timeoutMs?: number;
}

export interface ClaudeGatewayRoundResult {
  ok: boolean;
  checklist: ReturnType<typeof evaluateSdkScenarioChecklist> | null;
  upstreamExchangeCount: number;
  errors: string[];
}

export async function runClaudeGatewayRound(
  input: ClaudeGatewayRoundInput,
): Promise<ClaudeGatewayRoundResult> {
  const profile = resolveProfile(input.profileId);
  const modelAlias = resolveProfileModelAlias(input.profileId);
  const apiCompat = resolveProfileApiCompat(input.profileId);
  const timeoutMs = input.timeoutMs ?? Number.parseInt(process.env.ECO_CLAUDE_SMOKE_TIMEOUT_MS ?? "600000", 10);
  const baseUrl = input.stack.bridgeBaseUrl;

  input.stack.setActiveCell({
    client: "claude",
    profileId: input.profileId,
    scenarioId: FULL_ROUND_SCENARIO_ID,
  });

  ensureDir(input.outDir);
  const workspace = path.join(input.outDir, "workspace");
  if (fs.existsSync(workspace)) {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
  fs.mkdirSync(workspace, { recursive: true });
  const mcpServerPath = resolveMcpEchoServerPath();
  const nodeExe = resolveNodeExecutable();
  const mcpLogPath = path.join(input.outDir, "mcp-server.log");
  const claudeExecutable = resolveClaudeExecutable();
  const sdkMessagesPath = path.join(input.outDir, "sdk-messages.jsonl");
  const agentEventsPath = path.join(input.outDir, "agent-events.jsonl");

  const { skillDir } = setupScenarioWorkspace({
    workspace,
    marker: input.marker,
    skillDestRoots: [path.join(workspace, ".claude", "skills", "smoke-skill")],
  });
  const prompt = buildScenarioPrompt(input.marker);
  fs.writeFileSync(path.join(input.outDir, "prompt.txt"), prompt);

  let sdkSeq = 0;
  let agentSeq = 0;
  function logSdkMessage(message: unknown) {
    appendJsonl(sdkMessagesPath, {
      seq: ++sdkSeq,
      ts: new Date().toISOString(),
      message: redactSecrets(message, input.stack.secrets),
    });
  }
  function logAgentEvent(event: AgentEvent) {
    appendJsonl(agentEventsPath, {
      seq: ++agentSeq,
      ts: new Date().toISOString(),
      event: redactSecrets(event, input.stack.secrets),
    });
  }

  const mcpServers = {
    eco_smoke: {
      command: nodeExe,
      args: [mcpServerPath],
      env: { ECO_SMOKE_MCP_LOG: mcpLogPath },
    },
  };

  const agentRegistry: EcoAgentRuntimeConfig = {
    templates: [
      {
        id: "smoke.worker",
        name: "Smoke Worker",
        description: "Short-lived worker for Eco gateway client round.",
        prompt:
          "You are smoke_worker. Reply with exactly the marker string the parent asked for. Do not call tools unless required.",
        whenToUse: "When the parent delegates a smoke task.",
        defaultTools: {
          allowed: [],
          disallowed: [],
          bash: { enabled: false },
          filesystem: { read: "none", write: "none" },
        },
        mcpServers: [],
        skills: [],
        allowDelegation: false,
        builtIn: true,
        source: "built_in",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    orchestration: {
      mainAgent: {
        agentKey: "planner",
        name: "Main",
        systemPromptPreset: "core_native",
        prompt: "",
        modelRef: { providerId: profile.id, modelId: modelAlias },
        tools: { allowed: [], disallowed: [] },
        skills: [],
      },
      agents: [
        {
          agentKey: "smoke_worker",
          templateId: "smoke.worker",
          modelRef: { providerId: profile.id, modelId: modelAlias },
          tools: {
            allowed: [],
            disallowed: [],
            bash: { enabled: false },
            filesystem: { read: "none", write: "none" },
          },
          mcpServers: [],
          skills: [],
          enabled: true,
        },
      ],
      strategy: { kind: "autonomous" },
    },
  };

  const driver = new ClaudeAgentSdkDriver({
    apiKey: GATEWAY_LOCAL_CLIENT_KEY,
    baseUrl,
    anthropicAuthMode: "bearer",
    ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {}),
    executionPermissionMode: "bypassPermissions",
    onSdkMessage: logSdkMessage,
    toolPermissionHandler: async () => ({ behavior: "allow" }),
  });

  const errors: string[] = [];
  let checklist: ReturnType<typeof evaluateSdkScenarioChecklist> | null = null;
  const threadId = `thr_claude_gw_${input.marker}_${profile.id}`;

  try {
    const agentEvents: AgentEvent[] = [];
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), timeoutMs);

    for await (const event of driver.run({
      threadId,
      prompt,
      workspacePath: workspace,
      worktreePath: workspace,
      routes: [
        {
          role: "planner",
          providerId: profile.id,
          modelId: modelAlias,
          apiCompat,
          primary: { modelId: modelAlias, contextWindow: 200_000 },
          fallbacks: [],
        },
      ],
      signal: ac.signal,
      agentRegistry,
      sdkSession: {
        skills: ["smoke-skill"],
        mcpServers,
        runtimeMcpServers: ["eco_smoke"],
      },
    })) {
      agentEvents.push(event);
      logAgentEvent(event);
      if (event.type === "run.terminal") {
        // Claude CLI may keep the SDK stream open after result; abort so recording can finish.
        ac.abort();
      }
    }
    clearTimeout(timeout);

    const workspaceFiles = snapshotWorkspace(workspace);
    writeJson(path.join(input.outDir, "workspace-files.json"), workspaceFiles);

    checklist = evaluateSdkScenarioChecklist({
      agentEvents,
      workspaceFiles,
      marker: input.marker,
      skillsListed: true,
    });
    writeJson(path.join(input.outDir, "checklist.json"), checklist);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    try {
      fs.rmSync(workspace, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  const ok = Boolean(checklist?.ok);
  return { ok, checklist, upstreamExchangeCount: 0, errors };
}
