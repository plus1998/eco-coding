/**
 * Full conversation-round scenario via Codex → Eco Bridge → Gateway.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCodexGatewayModelAlias,
  buildCodexModelProviderSlug,
} from "../../../packages/runtime/src/codex-config-sync.ts";
import { CodexAppServerClient } from "../../../packages/runtime/src/codex-app-server-client.ts";
import { listCodexSkills } from "../../../packages/runtime/src/codex-skills-list.ts";
import { syncEcoCodexHooks } from "../../../packages/runtime/src/codex-hooks-sync.ts";
import { evaluateScenarioChecklist } from "../../codex-scenario-smoke/assert.mjs";
import { buildScenarioPrompt } from "../../conversation-round/lib/scenario-prompt.mjs";
import {
  resolveCodexExecutable,
  resolveMcpEchoServerPath,
  resolveNodeExecutable,
} from "../../conversation-round/lib/resolve-executables.mjs";
import { setupScenarioWorkspace } from "../../conversation-round/lib/scenario-workspace.mjs";
import { appendJsonl, redactSecrets, snapshotWorkspace, writeJson } from "../../conversation-round/lib/fixture-io.mjs";
import { FULL_ROUND_SCENARIO_ID } from "../lib/client-matrix.mjs";
import { resolveProfile } from "../lib/profiles.mjs";
import type { GatewayRecordingStack } from "../lib/gateway-stack.mts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface CodexGatewayRoundInput {
  stack: GatewayRecordingStack;
  profileId: string;
  outDir: string;
  marker: string;
  timeoutMs?: number;
}

export interface CodexGatewayRoundResult {
  ok: boolean;
  checklist: ReturnType<typeof evaluateScenarioChecklist> | null;
  upstreamExchangeCount: number;
  errors: string[];
}

export async function runCodexGatewayRound(
  input: CodexGatewayRoundInput,
): Promise<CodexGatewayRoundResult> {
  const profile = resolveProfile(input.profileId);
  const providerSlug = buildCodexModelProviderSlug(profile.id);
  const modelAlias = buildCodexGatewayModelAlias(profile.id, profile.model);
  const timeoutMs = input.timeoutMs ?? Number.parseInt(process.env.ECO_CODEX_SMOKE_TIMEOUT_MS ?? "600000", 10);
  const gatewayBaseUrl = input.stack.gatewayBaseUrl;

  input.stack.setActiveCell({
    client: "codex",
    profileId: input.profileId,
    scenarioId: FULL_ROUND_SCENARIO_ID,
  });

  fs.mkdirSync(input.outDir, { recursive: true });
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "eco-gw-codex-home-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "eco-gw-codex-ws-"));
  const mcpServerPath = resolveMcpEchoServerPath();
  const nodeExe = resolveNodeExecutable();
  const mcpLog = path.join(input.outDir, "mcp-server.log");
  const rpcLogPath = path.join(input.outDir, "rpc-log.jsonl");

  const { skillDir } = setupScenarioWorkspace({ workspace, marker: input.marker });
  const codexSkillDir = path.join(codexHome, "skills", "smoke-skill");
  fs.mkdirSync(codexSkillDir, { recursive: true });
  fs.copyFileSync(path.join(skillDir, "SKILL.md"), path.join(codexSkillDir, "SKILL.md"));
  const prompt = buildScenarioPrompt(input.marker);
  fs.writeFileSync(path.join(input.outDir, "prompt.txt"), prompt);

  let seq = 0;
  const rpcLog: Array<Record<string, unknown>> = [];
  function logRpc(entry: Record<string, unknown>) {
    const row = { seq: ++seq, ts: new Date().toISOString(), ...entry };
    rpcLog.push(row);
    appendJsonl(rpcLogPath, redactSecrets(row, input.stack.secrets));
  }

  const hooks = await syncEcoCodexHooks({ codexHomeDir: codexHome, enableSpawnAgent: true });
  const agentRolePath = writeAgentRole(codexHome, modelAlias, providerSlug);
  writeConfigToml({
    codexHome,
    modelAlias,
    providerSlug,
    gatewayBaseUrl,
    trustTomlBlock: hooks.trustTomlBlock,
    mcpServerPath,
    nodeExe,
    mcpLog,
  });

  const child = spawn(resolveCodexExecutable(), ["app-server", "--stdio"], {
    env: { ...process.env, CODEX_HOME: codexHome },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    fs.appendFileSync(path.join(input.outDir, "codex-stderr.log"), chunk);
  });

  const errors: string[] = [];
  let checklist: ReturnType<typeof evaluateScenarioChecklist> | null = null;

  const client = CodexAppServerClient.attachToProcess(child, {
    timeoutMs: Math.min(timeoutMs, 120_000),
    onServerRequest: async (method) => {
      logRpc({ kind: "server_request", direction: "server→client", method });
      if (method.includes("requestApproval") || method.endsWith("/requestApproval")) {
        return { decision: "accept", accept: true, approved: true };
      }
      if (method.includes("requestUserInput") || method.includes("elicitation")) {
        return {
          answers: {},
          accepted: true,
          content: [{ type: "text", text: "approved by gateway codex round" }],
        };
      }
      const err = new Error(`unhandled server request ${method}`);
      (err as Error & { code: number }).code = -32601;
      throw err;
    },
  });

  client.addNotificationHandler((method, params) => {
    logRpc({ kind: "notification", direction: "server→client", method, params });
  });

  let threadId: string | undefined;

  try {
    const init = await client.initialize({
      clientInfo: {
        name: "eco_gateway_client_round",
        title: "Eco Gateway Client Round (Codex)",
        version: "1.0.0",
      },
      capabilities: { experimentalApi: true },
    });
    logRpc({ kind: "client_result", method: "initialize", params: init });

    const skills = await listCodexSkills(client, { cwds: [workspace], forceReload: true });
    logRpc({ kind: "client_result", method: "skills/list", params: skills });
    writeJson(path.join(input.outDir, "skills-list.json"), skills);

    const threadConfig = {
      model: modelAlias,
      features: { multi_agent: true, hooks: true },
      agents: {
        max_threads: 8,
        max_depth: 1,
        smoke_worker: {
          description: "Short-lived worker for Eco gateway client round.",
          config_file: agentRolePath,
        },
      },
      skills: {
        config: [{ path: codexSkillDir, enabled: true }],
      },
      mcp_servers: {
        eco_smoke: { enabled: true, enabled_tools: ["smoke_ping", "smoke_echo"] },
      },
    };

    const started = await client.request("thread/start", {
      cwd: workspace,
      modelProvider: providerSlug,
      model: modelAlias,
      config: threadConfig,
    });
    threadId = started.thread.id;
    logRpc({ kind: "client_result", method: "thread/start", params: started });

    const turnDone = waitForNotification(client, "turn/completed", threadId, timeoutMs);
    await client.request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt }],
      cwd: workspace,
    });
    await turnDone;
    await waitIdle(client, threadId, timeoutMs);

    const workspaceFiles = snapshotWorkspace(workspace);
    writeJson(path.join(input.outDir, "workspace-files.json"), workspaceFiles);

    checklist = evaluateScenarioChecklist({
      rpcLog,
      workspaceFiles,
      marker: input.marker,
      skillsListResult: skills,
    });
    writeJson(path.join(input.outDir, "checklist.json"), checklist);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (threadId) {
      try {
        await client.request("thread/close", { threadId });
      } catch {
        // ignore
      }
    }
    client.close();
    child.kill("SIGTERM");
    await Bun.sleep(400);
    try {
      fs.rmSync(codexHome, { recursive: true, force: true });
      fs.rmSync(workspace, { recursive: true, force: true });
    } catch {
      // ignore
    }
    if (stderr.trim()) {
      fs.writeFileSync(path.join(input.outDir, "codex-stderr-tail.log"), stderr.slice(-8000));
    }
  }

  const ok = Boolean(checklist?.ok);
  return { ok, checklist, upstreamExchangeCount: 0, errors };
}

function writeConfigToml(input: {
  codexHome: string;
  modelAlias: string;
  providerSlug: string;
  gatewayBaseUrl: string;
  trustTomlBlock: string;
  mcpServerPath: string;
  nodeExe: string;
  mcpLog: string;
}) {
  const lines = [
    "# Generated by gateway-http-round codex client",
    `model = ${JSON.stringify(input.modelAlias)}`,
    `model_provider = ${JSON.stringify(input.providerSlug)}`,
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    "",
    "[features]",
    "remote_plugin = false",
    "plugins = false",
    "multi_agent = true",
    "hooks = true",
    "",
    "[agents]",
    "max_threads = 8",
    "max_depth = 1",
    "",
    `[model_providers.${input.providerSlug}]`,
    `name = "Eco Gateway (${input.providerSlug})"`,
    `base_url = ${JSON.stringify(input.gatewayBaseUrl)}`,
    'wire_api = "responses"',
    "stream_idle_timeout_ms = 900000",
    "request_max_retries = 0",
    "",
    "[mcp_servers.eco_smoke]",
    `command = ${JSON.stringify(input.nodeExe)}`,
    `args = ${JSON.stringify([input.mcpServerPath])}`,
    'enabled_tools = ["smoke_ping", "smoke_echo"]',
    "startup_timeout_sec = 60",
    "",
    "[mcp_servers.eco_smoke.env]",
    `ECO_SMOKE_MCP_LOG = ${JSON.stringify(input.mcpLog)}`,
    "",
    input.trustTomlBlock.trim(),
    "",
  ];
  fs.writeFileSync(path.join(input.codexHome, "config.toml"), `${lines.join("\n").trim()}\n`);
}

function writeAgentRole(codexHome: string, modelAlias: string, providerSlug: string) {
  const agentsDir = path.join(codexHome, "agents");
  fs.mkdirSync(agentsDir, { recursive: true });
  const rolePath = path.join(agentsDir, "smoke_worker.toml");
  const toml = [
    'name = "smoke_worker"',
    'description = "Short worker for Eco gateway client round."',
    `developer_instructions = ${JSON.stringify(
      "You are smoke_worker. Reply with exactly the marker string the parent asked for.",
    )}`,
    `model = ${JSON.stringify(modelAlias)}`,
    `model_provider = ${JSON.stringify(providerSlug)}`,
    'sandbox_mode = "workspace-write"',
    'approval_policy = "never"',
    "",
    "[sandbox_workspace_write]",
    "network_access = false",
    "",
  ].join("\n");
  fs.writeFileSync(rolePath, toml);
  return rolePath;
}

function waitForNotification(
  client: CodexAppServerClient,
  method: string,
  threadId: string,
  waitMs: number,
) {
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      remove();
      reject(new Error(`timeout waiting for ${method} on ${threadId}`));
    }, waitMs);
    const remove = client.addNotificationHandler((m, p) => {
      if (m !== method) return;
      if (p?.threadId && p.threadId !== threadId) return;
      clearTimeout(timer);
      remove();
      resolve(p);
    });
  });
}

async function waitIdle(client: CodexAppServerClient, threadId: string, waitMs: number) {
  const started = Date.now();
  let lastStatus: unknown = null;
  while (Date.now() - started < waitMs) {
    const r = await client.request("thread/read", { threadId, includeTurns: false });
    const status = r.thread?.status;
    const type = typeof status === "string" ? status : status?.type;
    lastStatus = type ?? status;
    if (type === "idle") return;
    if (type === "systemError" || type === "failed" || type === "closed") {
      throw new Error(`thread terminal status: ${JSON.stringify(status)}`);
    }
    await Bun.sleep(200);
  }
  throw new Error(`thread not idle (last=${JSON.stringify(lastStatus)})`);
}
