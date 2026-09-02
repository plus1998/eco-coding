/**
 * Record a live Claude Agent SDK conversation round via LongCat Anthropic surface.
 *
 *   LONGCAT_API_KEY=... bun scripts/conversation-round/record-claude.mts
 *
 * LongCat routes Anthropic Messages at:
 *   https://api.longcat.chat/anthropic/v1/messages
 *
 * Optional:
 *   ECO_CLAUDE_SMOKE_BASE_URL  default https://api.longcat.chat/anthropic
 *   ECO_CLAUDE_SMOKE_MODEL     default LongCat-2.0
 *   CLAUDE_EXECUTABLE          override bundled claude binary
 *
 * Writes:
 *   scripts/conversation-round/fixtures/<runId>-claude/
 *     sdk-messages.jsonl
 *     agent-events.jsonl
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EcoAgentRuntimeConfig } from "../../packages/runtime/src/agent-orchestration";
import { ClaudeAgentSdkDriver } from "../../packages/runtime/src/claude-agent-sdk";
import type { AgentEvent } from "../../packages/shared/src";
import { appendJsonl, ensureDir, redactSecrets, snapshotWorkspace, writeJson } from "./lib/fixture-io.mjs";
import {
  resolveClaudeExecutable,
  resolveMcpEchoServerPath,
  resolveNodeExecutable,
} from "./lib/resolve-executables.mjs";
import { buildScenarioPrompt } from "./lib/scenario-prompt.mjs";
import { setupScenarioWorkspace } from "./lib/scenario-workspace.mjs";
import { evaluateSdkScenarioChecklist } from "./lib/sdk-checklist.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, "fixtures");

const apiKey =
  process.env.LONGCAT_API_KEY?.trim() ||
  process.env.ECO_CODEX_SMOKE_API_KEY?.trim() ||
  process.env.ANTHROPIC_API_KEY?.trim() ||
  process.env.ECO_CLAUDE_SMOKE_API_KEY?.trim() ||
  "";
// Claude SDK appends `/v1/messages` to ANTHROPIC_BASE_URL.
const baseUrl = (process.env.ECO_CLAUDE_SMOKE_BASE_URL ?? "https://api.longcat.chat/anthropic").replace(
  /\/$/,
  "",
);
const model = process.env.ECO_CLAUDE_SMOKE_MODEL?.trim() || "LongCat-2.0";
const providerId = process.env.ECO_CLAUDE_SMOKE_PROVIDER?.trim() || "longcat";
const TIMEOUT_MS = Number.parseInt(process.env.ECO_CLAUDE_SMOKE_TIMEOUT_MS ?? "600000", 10);

if (!apiKey) {
  console.error("Missing LONGCAT_API_KEY (or ECO_CODEX_SMOKE_API_KEY / ANTHROPIC_API_KEY)");
  process.exit(2);
}

const marker = process.env.ECO_SMOKE_MARKER?.trim() || `LC${Date.now().toString(36).toUpperCase()}`;
const runId =
  process.env.ECO_CLAUDE_SMOKE_RUN_ID?.trim() ||
  `${new Date().toISOString().replace(/[:.]/g, "-")}-${marker}-claude`;
const outDir = process.env.ECO_CLAUDE_SMOKE_FIXTURE_DIR?.trim()
  ? path.resolve(process.env.ECO_CLAUDE_SMOKE_FIXTURE_DIR)
  : path.join(fixturesRoot, runId);

ensureDir(outDir);
ensureDir(fixturesRoot);

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "eco-claude-round-ws-"));
const mcpServerPath = resolveMcpEchoServerPath();
const nodeExe = resolveNodeExecutable();
const mcpLogPath = path.join(outDir, "mcp-server.log");
const claudeExecutable = resolveClaudeExecutable();

const { skillDir } = setupScenarioWorkspace({ workspace, marker });
const prompt = buildScenarioPrompt(marker);
fs.writeFileSync(path.join(outDir, "prompt.txt"), prompt);

const sdkMessagesPath = path.join(outDir, "sdk-messages.jsonl");
const agentEventsPath = path.join(outDir, "agent-events.jsonl");
let sdkSeq = 0;
let agentSeq = 0;

function logSdkMessage(message: unknown) {
  appendJsonl(sdkMessagesPath, {
    seq: ++sdkSeq,
    ts: new Date().toISOString(),
    message: redactSecrets(message, apiKey),
  });
}

function logAgentEvent(event: AgentEvent) {
  appendJsonl(agentEventsPath, {
    seq: ++agentSeq,
    ts: new Date().toISOString(),
    event: redactSecrets(event, apiKey),
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
      description: "Short-lived worker for Eco scenario smoke.",
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
      modelRef: { providerId, modelId: model },
      tools: { allowed: [], disallowed: [] },
      skills: [],
    },
    agents: [
      {
        agentKey: "smoke_worker",
        templateId: "smoke.worker",
        modelRef: { providerId, modelId: model },
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
  apiKey,
  baseUrl,
  anthropicAuthMode: "bearer",
  ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {}),
  executionPermissionMode: "bypassPermissions",
  onSdkMessage: logSdkMessage,
  toolPermissionHandler: async () => ({ behavior: "allow" }),
});

const report = {
  core: "claude",
  runId,
  marker,
  model,
  baseUrl,
  claudeExecutable: claudeExecutable ?? null,
  startedAt: new Date().toISOString(),
  ok: false,
  checklist: null as ReturnType<typeof evaluateSdkScenarioChecklist> | null,
  errors: [] as string[],
};

const threadId = `thr_claude_${marker}`;

try {
  const agentEvents: AgentEvent[] = [];
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), TIMEOUT_MS);

  for await (const event of driver.run({
    threadId,
    prompt,
    workspacePath: workspace,
    worktreePath: workspace,
    routes: [
      {
        role: "planner",
        providerId,
        modelId: model,
        primary: { modelId: model, contextWindow: 200_000 },
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
  }
  clearTimeout(timeout);

  const workspaceFiles = snapshotWorkspace(workspace);
  writeJson(path.join(outDir, "workspace-files.json"), workspaceFiles);

  const evaluation = evaluateSdkScenarioChecklist({
    agentEvents,
    workspaceFiles,
    marker,
    skillsListed: true,
  });
  report.checklist = evaluation;
  report.ok = evaluation.ok;
  report.finishedAt = new Date().toISOString();
  report.agentEventCount = agentEvents.length;
  report.sdkMessageCount = sdkSeq;

  writeJson(path.join(outDir, "summary.json"), report);
  writeJson(path.join(outDir, "meta.json"), {
    core: "claude",
    runId,
    marker,
    model,
    baseUrl,
    claudeExecutable,
    workspace,
    recordedAt: report.finishedAt,
    apiKeyRedacted: true,
  });

  writeJson(path.join(fixturesRoot, "latest-claude.json"), {
    runId,
    path: outDir,
    marker,
    ok: report.ok,
    recordedAt: report.finishedAt,
  });

  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        runId,
        outDir,
        failed: evaluation.failed,
        checklist: evaluation.checklist,
      },
      null,
      2,
    ),
  );
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  report.errors.push(String(error));
  report.finishedAt = new Date().toISOString();
  writeJson(path.join(outDir, "summary.json"), report);
  console.error(error);
  process.exitCode = 1;
} finally {
  try {
    fs.rmSync(workspace, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
