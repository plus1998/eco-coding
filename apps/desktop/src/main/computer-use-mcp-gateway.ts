import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { CodexMcpServerForConfigSync } from "@eco/runtime";
import {
  buildEcoComputerUsePromptAppend,
  ECO_COMPUTER_USE_ALLOWED_TOOL,
  ECO_COMPUTER_USE_MCP_SERVER,
  ECO_COMPUTER_USE_TOOLS,
  shouldAutoApproveEcoComputerUseTools,
  type ComputerUseSettingsSnapshot,
} from "../shared/computer-use";
import type { McpSdkConfig } from "../shared/mcp";
import { createBrowserMcpControlSecret } from "./browser-mcp-auth";
import {
  resolveOpenComputerUseBinary,
  type OpenComputerUseResolveResult,
} from "./open-computer-use-resolve";

const require = createRequire(import.meta.url);

export interface ComputerUseMcpInjection {
  enabled: boolean;
  serverName: typeof ECO_COMPUTER_USE_MCP_SERVER;
  sdkEntry?: Record<string, unknown>;
  codexServer?: CodexMcpServerForConfigSync;
  allowedToolPattern?: string;
  autoApproveTools?: boolean;
  promptAppend?: string;
  unavailableReason?: string;
}

export interface ComputerUseFeatureAvailability {
  available: boolean;
  reason?: string;
  /** Raw doctor stdout/stderr when probed (macOS). */
  doctorOutput?: string;
}

export type ComputerUseSettingsGetter = () => ComputerUseSettingsSnapshot;

export type ComputerUseMcpGatewayDeps = {
  /** Fired when the stdio proxy observes tools/call (presence overlay). */
  onToolCall?: (input: {
    threadId: string;
    toolName: string;
    toolInput?: Record<string, unknown>;
  }) => void;
};

const DOCTOR_TIMEOUT_MS = 12_000;

function resolveStdioScriptPath(): string {
  const candidates = [
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../packaging/eco-computer-use-mcp-stdio.mjs"),
    path.join(process.cwd(), "apps/desktop/packaging/eco-computer-use-mcp-stdio.mjs"),
    path.join(process.cwd(), "packaging/eco-computer-use-mcp-stdio.mjs"),
  ];
  try {
    const electron = require("electron") as {
      app?: { getAppPath?: () => string };
    };
    if (electron.app?.getAppPath) {
      candidates.unshift(path.join(electron.app.getAppPath(), "packaging/eco-computer-use-mcp-stdio.mjs"));
    }
    if (typeof process.resourcesPath === "string") {
      candidates.unshift(path.join(process.resourcesPath, "packaging/eco-computer-use-mcp-stdio.mjs"));
      candidates.unshift(path.join(process.resourcesPath, "eco-computer-use-mcp-stdio.mjs"));
    }
  } catch {
    // non-electron
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return candidates[0]!;
}

/**
 * Probe OS permissions via `open-computer-use doctor`.
 * On success exits 0. Non-zero / timeout / spawn failure → unavailable with reason.
 * Windows/Linux still run doctor when the binary supports it; failure surfaces as unavailable.
 */
export async function probeOpenComputerUseDoctor(
  binaryPath: string,
  timeoutMs: number = DOCTOR_TIMEOUT_MS,
): Promise<{ ok: boolean; output: string; reason?: string }> {
  return await new Promise((resolve) => {
    let settled = false;
    const chunks: Buffer[] = [];
    const child = spawn(binaryPath, ["doctor"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const finish = (result: { ok: boolean; output: string; reason?: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish({
        ok: false,
        output: Buffer.concat(chunks).toString("utf8").trim(),
        reason: "open-computer-use doctor 超时；无法确认系统权限。",
      });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({
        ok: false,
        output: "",
        reason: `无法启动 open-computer-use doctor：${error.message}`,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString("utf8").trim();
      if (code === 0) {
        finish({ ok: true, output });
        return;
      }
      finish({
        ok: false,
        output,
        reason:
          output ||
          `open-computer-use doctor 失败（退出码 ${code ?? "unknown"}）。请授予 Accessibility / Screen Recording（macOS）或确认桌面会话可用。`,
      });
    });
  });
}

export class ComputerUseMcpGateway {
  private readonly controlSecret = createBrowserMcpControlSecret();
  private controlServer: http.Server | undefined;
  private controlPort: number | undefined;
  private disposed = false;

  constructor(
    private readonly getSettings: ComputerUseSettingsGetter,
    private readonly deps: ComputerUseMcpGatewayDeps = {},
  ) {}

  async start(): Promise<void> {
    if (this.controlServer || this.disposed) {
      return;
    }
    this.controlServer = http.createServer((req, res) => {
      void this.handleControl(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.controlServer!.listen(0, "127.0.0.1", () => resolve());
      this.controlServer!.once("error", reject);
    });
    this.controlPort = (this.controlServer.address() as AddressInfo).port;
  }

  get controlBaseUrl(): string {
    if (!this.controlPort) {
      throw new Error("Computer Use MCP control server not started");
    }
    return `http://127.0.0.1:${this.controlPort}`;
  }

  async close(): Promise<void> {
    this.disposed = true;
    if (this.controlServer) {
      await new Promise<void>((resolve) => this.controlServer!.close(() => resolve()));
      this.controlServer = undefined;
      this.controlPort = undefined;
    }
  }

  resolveBinary(): OpenComputerUseResolveResult {
    return resolveOpenComputerUseBinary();
  }

  /**
   * Settings master switch must be on and binary present.
   * Does not run doctor (cheap UI poll). Use {@link checkFeatureAvailable} before enabling.
   */
  isFeatureAvailableQuick(): ComputerUseFeatureAvailability {
    const settings = this.getSettings();
    if (!settings.agentIntegrationEnabled) {
      return { available: false, reason: "电脑操控 Agent 能力未在设置中开启" };
    }
    const resolved = this.resolveBinary();
    if (!resolved.available || !resolved.binaryPath) {
      return { available: false, reason: resolved.reason ?? "open-computer-use 不可用" };
    }
    return { available: true };
  }

  /** Full gate used when turning the master switch on (includes doctor). */
  async checkFeatureAvailable(): Promise<ComputerUseFeatureAvailability> {
    const resolved = this.resolveBinary();
    if (!resolved.available || !resolved.binaryPath) {
      return { available: false, reason: resolved.reason ?? "open-computer-use 不可用" };
    }
    const doctor = await probeOpenComputerUseDoctor(resolved.binaryPath);
    if (!doctor.ok) {
      return {
        available: false,
        reason: doctor.reason ?? "系统权限未就绪",
        ...(doctor.output ? { doctorOutput: doctor.output } : {}),
      };
    }
    return {
      available: true,
      ...(doctor.output ? { doctorOutput: doctor.output } : {}),
    };
  }

  getAgentPromptAppend(sessionEnabled: boolean): string | undefined {
    if (!sessionEnabled || !this.getSettings().agentIntegrationEnabled) {
      return undefined;
    }
    return buildEcoComputerUsePromptAppend();
  }

  private async buildStdioLaunch(binaryPath: string, threadId?: string): Promise<{
    command: string;
    args: string[];
    env: Record<string, string>;
  }> {
    await this.start();
    const stdioPath = resolveStdioScriptPath();
    if (!fs.existsSync(stdioPath)) {
      throw new Error(`Computer Use MCP stdio front-end not found: ${stdioPath}`);
    }
    return {
      command: process.execPath,
      args: [stdioPath],
      env: {
        ECO_COMPUTER_USE_CONTROL_URL: this.controlBaseUrl,
        ECO_COMPUTER_USE_CONTROL_SECRET: this.controlSecret,
        ECO_OPEN_COMPUTER_USE_BINARY: binaryPath,
        ELECTRON_RUN_AS_NODE: "1",
        ...(threadId?.trim() ? { ECO_COMPUTER_USE_THREAD_ID: threadId.trim() } : {}),
      },
    };
  }

  async resolveGlobalCodexServer(): Promise<CodexMcpServerForConfigSync | undefined> {
    if (!this.getSettings().agentIntegrationEnabled) {
      return undefined;
    }
    const resolved = this.resolveBinary();
    if (!resolved.available || !resolved.binaryPath) {
      throw new Error(resolved.reason ?? "open-computer-use unavailable");
    }
    const launch = await this.buildStdioLaunch(resolved.binaryPath);
    return {
      name: ECO_COMPUTER_USE_MCP_SERVER,
      transport: "stdio",
      command: launch.command,
      args: launch.args,
      env: launch.env,
      enabledTools: [...ECO_COMPUTER_USE_TOOLS],
      startupTimeoutSec: 60,
    };
  }

  async resolveInjection(input: {
    threadId: string;
    sessionEnabled: boolean;
  }): Promise<ComputerUseMcpInjection> {
    const settings = this.getSettings();
    if (!settings.agentIntegrationEnabled) {
      return { enabled: false, serverName: ECO_COMPUTER_USE_MCP_SERVER };
    }
    if (!input.sessionEnabled) {
      return { enabled: false, serverName: ECO_COMPUTER_USE_MCP_SERVER };
    }
    const resolved = this.resolveBinary();
    if (!resolved.available || !resolved.binaryPath) {
      return {
        enabled: false,
        serverName: ECO_COMPUTER_USE_MCP_SERVER,
        unavailableReason: resolved.reason ?? "open-computer-use 不可用",
      };
    }
    const autoApproveTools = shouldAutoApproveEcoComputerUseTools(settings.actionApprovalMode);
    const launch = await this.buildStdioLaunch(resolved.binaryPath, input.threadId);
    const codexServer: CodexMcpServerForConfigSync = {
      name: ECO_COMPUTER_USE_MCP_SERVER,
      transport: "stdio",
      command: launch.command,
      args: launch.args,
      env: launch.env,
      enabledTools: [...ECO_COMPUTER_USE_TOOLS],
      startupTimeoutSec: 60,
    };
    return {
      enabled: true,
      serverName: ECO_COMPUTER_USE_MCP_SERVER,
      sdkEntry: {
        type: "stdio",
        command: launch.command,
        args: launch.args,
        env: launch.env,
        alwaysLoad: true,
      },
      codexServer,
      allowedToolPattern: ECO_COMPUTER_USE_ALLOWED_TOOL,
      autoApproveTools,
      promptAppend: buildEcoComputerUsePromptAppend(),
    };
  }

  mergeIntoSdkConfig(base: McpSdkConfig, injection: ComputerUseMcpInjection): McpSdkConfig {
    if (!injection.enabled || !injection.sdkEntry) {
      return base;
    }
    const allowedTools = [...base.allowedTools];
    if (injection.autoApproveTools && injection.allowedToolPattern) {
      allowedTools.push(injection.allowedToolPattern);
    } else if (injection.allowedToolPattern) {
      // Strip any prior auto-approve patterns for this server when always_ask.
      const filtered = allowedTools.filter((tool) => tool !== injection.allowedToolPattern);
      return {
        mcpServers: { ...base.mcpServers, [ECO_COMPUTER_USE_MCP_SERVER]: injection.sdkEntry },
        allowedTools: [...new Set(filtered)],
      };
    }
    return {
      mcpServers: { ...base.mcpServers, [ECO_COMPUTER_USE_MCP_SERVER]: injection.sdkEntry },
      allowedTools: [...new Set(allowedTools)],
    };
  }

  private async handleControl(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (this.disposed) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "disposed" }));
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }
    const secret = req.headers["x-eco-computer-use-control-secret"];
    if (secret !== this.controlSecret) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    let body: Record<string, unknown> = {};
    try {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.trim()) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          body = parsed as Record<string, unknown>;
        }
      }
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid json" }));
      return;
    }

    try {
      const url = req.url || "";
      if (url === "/v1/tool-started") {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) {
          throw new Error("tool-started requires name");
        }
        const threadId =
          typeof body.threadId === "string" && body.threadId.trim()
            ? body.threadId.trim()
            : "global";
        const toolInput =
          body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)
            ? (body.arguments as Record<string, unknown>)
            : undefined;
        this.deps.onToolCall?.({
          threadId,
          toolName: name.includes("eco_computer_use") || name.startsWith("mcp__")
            ? name
            : `mcp__${ECO_COMPUTER_USE_MCP_SERVER}__${name}`,
          ...(toolInput ? { toolInput } : {}),
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  }
}
