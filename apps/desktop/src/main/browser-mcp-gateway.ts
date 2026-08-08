import { createRequire } from "node:module";
import fs from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CodexMcpServerForConfigSync } from "@eco/runtime";
import {
  ECO_AGENT_BROWSER_ALLOWED_TOOL,
  ECO_AGENT_BROWSER_MCP_SERVER,
  browserAgentSessionKey,
  buildEcoAgentBrowserPromptAppend,
} from "../shared/browser";
import type { McpSdkConfig } from "../shared/mcp";
import {
  buildAgentBrowserMcpArgs,
  resolveAgentBrowserBinary,
} from "./agent-browser-resolve";
import {
  BrowserMcpAuthRegistry,
  createBrowserMcpControlSecret,
} from "./browser-mcp-auth";
import { BrowserMcpToolClaimRouter } from "./browser-mcp-router";

const require = createRequire(import.meta.url);

function resolveStdioScriptPath(): string {
  const candidates = [
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../packaging/eco-browser-mcp-stdio.mjs"),
    path.join(process.cwd(), "apps/desktop/packaging/eco-browser-mcp-stdio.mjs"),
    path.join(process.cwd(), "packaging/eco-browser-mcp-stdio.mjs"),
  ];
  try {
    const electron = require("electron") as {
      app?: { getAppPath?: () => string };
    };
    if (electron.app?.getAppPath) {
      candidates.unshift(path.join(electron.app.getAppPath(), "packaging/eco-browser-mcp-stdio.mjs"));
    }
    if (typeof process.resourcesPath === "string") {
      candidates.unshift(path.join(process.resourcesPath, "packaging/eco-browser-mcp-stdio.mjs"));
      candidates.unshift(path.join(process.resourcesPath, "eco-browser-mcp-stdio.mjs"));
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
type JsonRpcMsg = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string; code?: number };
};

class AgentBrowserMcpChild {
  private readonly proc: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private toolsCache: Array<Record<string, unknown>> | undefined;
  private readonly ready: Promise<void>;

  constructor(
    binaryPath: string,
    cdpPort: number,
    sessionKey: string,
    extraEnv: Record<string, string>,
  ) {
    const args = buildAgentBrowserMcpArgs(cdpPort, sessionKey);
    this.proc = spawn(binaryPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.proc.stderr.on("data", (chunk: Buffer | string) => {
      process.stderr.write(`[eco-browser-ab-child] ${chunk}`);
    });
    this.proc.on("exit", (code) => {
      for (const [, p] of this.pending) {
        p.reject(new Error(`agent-browser mcp exited (${code})`));
      }
      this.pending.clear();
    });
    this.ready = this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "eco-browser-gateway", version: "1.0.0" },
    }).then(() => {
      this.notify("notifications/initialized", {});
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: JsonRpcMsg;
      try {
        msg = JSON.parse(line) as JsonRpcMsg;
      } catch {
        continue;
      }
      if (msg.id === undefined || msg.id === null) {
        continue;
      }
      const id = Number(msg.id);
      const pending = this.pending.get(id);
      if (!pending) continue;
      this.pending.delete(id);
      if (msg.error) {
        pending.reject(new Error(msg.error.message || `rpc error ${msg.error.code}`));
      } else {
        pending.resolve(msg.result);
      }
    }
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} })}\n`,
      );
    });
  }

  async listTools(): Promise<Array<Record<string, unknown>>> {
    await this.ready;
    if (this.toolsCache) {
      return this.toolsCache;
    }
    const result = (await this.request("tools/list", {})) as { tools?: Array<Record<string, unknown>> };
    this.toolsCache = result.tools ?? [];
    return this.toolsCache;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ready;
    return this.request("tools/call", { name, arguments: args });
  }

  kill(): void {
    try {
      this.proc.kill();
    } catch {
      // ignore
    }
  }
}

export type BrowserMcpGatewayDeps = {
  ensureCdpPort: (threadId: string) => Promise<number>;
  agentBrowserEnv: (cdpPort: number, threadId: string) => Record<string, string>;
};

/**
 * Eco-owned browser MCP: fixed server name `eco_agent_browser`, auth + claim routing to
 * per-thread agent-browser CDP children.
 */
export class BrowserMcpGateway {
  private readonly auth = new BrowserMcpAuthRegistry();
  private readonly claims = new BrowserMcpToolClaimRouter();
  private readonly children = new Map<string, AgentBrowserMcpChild>();
  private readonly controlSecret = createBrowserMcpControlSecret();
  private controlServer: http.Server | undefined;
  private controlPort: number | undefined;
  private disposed = false;

  constructor(private readonly deps: BrowserMcpGatewayDeps) {}

  async start(): Promise<void> {
    if (this.controlServer) {
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
      throw new Error("Browser MCP control server not started");
    }
    return `http://127.0.0.1:${this.controlPort}`;
  }

  /** Call from Eco when tool.started for browser tools on a thread. */
  noteUpcomingTool(threadId: string, toolName?: string): void {
    this.claims.noteUpcoming(threadId, toolName);
  }

  /**
   * Ensure CDP + token + agent-browser child for a thread; return injection payloads.
   */
  async prepareThread(threadId: string): Promise<{
    token: string;
    cdpPort: number;
    sdkEntry: Record<string, unknown>;
    codexServer: CodexMcpServerForConfigSync;
    promptAppend: string;
  }> {
    await this.start();
    const cdpPort = await this.deps.ensureCdpPort(threadId);
    const record = this.auth.issue(threadId);
    await this.ensureChild(threadId, cdpPort);

    const stdioPath = resolveStdioScriptPath();
    const nodeBin = process.execPath;
    // Prefer ELECTRON_RUN_AS_NODE when running under Electron so packaging works.
    const baseEnv = {
      ECO_BROWSER_CONTROL_URL: this.controlBaseUrl,
      ECO_BROWSER_CONTROL_SECRET: this.controlSecret,
      ELECTRON_RUN_AS_NODE: "1",
    };

    // Claude (and any per-session stdio): seal token so all tools bind to this thread.
    const sealedEnv = {
      ...baseEnv,
      ECO_BROWSER_AUTH_TOKEN: record.token,
    };

    // Codex global MCP: no sealed token — concurrent clients share one process; claim + optional token.
    const codexEnv = { ...baseEnv };

    const stdioArgs = [stdioPath];
    const sdkEntry = {
      type: "stdio" as const,
      command: nodeBin,
      args: stdioArgs,
      env: sealedEnv,
      alwaysLoad: true,
    };
    const codexServer: CodexMcpServerForConfigSync = {
      name: ECO_AGENT_BROWSER_MCP_SERVER,
      transport: "stdio",
      command: nodeBin,
      args: stdioArgs,
      env: codexEnv,
      startupTimeoutSec: 60,
    };

    return {
      token: record.token,
      cdpPort,
      sdkEntry,
      codexServer,
      promptAppend: buildEcoAgentBrowserPromptAppend(threadId),
    };
  }

  private async ensureChild(threadId: string, cdpPort: number): Promise<AgentBrowserMcpChild> {
    const existing = this.children.get(threadId);
    if (existing) {
      return existing;
    }
    const resolved = resolveAgentBrowserBinary();
    if (!resolved.available || !resolved.binaryPath) {
      throw new Error(resolved.reason ?? "agent-browser 不可用");
    }
    const sessionKey = browserAgentSessionKey(threadId);
    const env = this.deps.agentBrowserEnv(cdpPort, threadId);
    const child = new AgentBrowserMcpChild(resolved.binaryPath, cdpPort, sessionKey, env);
    this.children.set(threadId, child);
    return child;
  }

  private resolveThreadForCall(input: {
    authToken?: string;
    toolName?: string;
  }): string {
    const fromAuth = this.auth.resolve(input.authToken);
    if (fromAuth) {
      return fromAuth.threadId;
    }
    const claimed = this.claims.claim(input.toolName);
    if (claimed) {
      return claimed;
    }
    throw new Error(
      "Browser MCP 无法绑定会话：缺少有效 Authorization，且没有匹配的 tool.started claim。并发会话需要 Eco 看到 tool.started 或使用带 token 的连接。",
    );
  }

  private async handleControl(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const secret = req.headers["x-eco-browser-control-secret"];
    if (secret !== this.controlSecret) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized control secret" }));
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) {
      chunks.push(c as Buffer);
    }
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid json" }));
      return;
    }
    const authHeader = req.headers.authorization;
    const bearer =
      typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : undefined;
    const authToken =
      (typeof body.authToken === "string" ? body.authToken : undefined) ?? bearer;

    try {
      const url = req.url || "";
      if (url === "/v1/tools/list") {
        let threadId = this.auth.resolve(authToken)?.threadId;
        if (!threadId) {
          threadId = [...this.children.keys()][0];
        }
        if (!threadId) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ tools: [] }));
          return;
        }
        const cdp = await this.deps.ensureCdpPort(threadId);
        const child = await this.ensureChild(threadId, cdp);
        const tools = await child.listTools();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ tools }));
        return;
      }
      if (url === "/v1/tools/call") {
        const name = typeof body.name === "string" ? body.name : "";
        if (!name) {
          throw new Error("tools/call requires name");
        }
        const args =
          body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)
            ? (body.arguments as Record<string, unknown>)
            : {};
        const threadId = this.resolveThreadForCall({ authToken, toolName: name });
        const cdp = await this.deps.ensureCdpPort(threadId);
        const child = await this.ensureChild(threadId, cdp);
        const result = await child.callTool(name, args);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result }));
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

  disposeThread(threadId: string): void {
    this.auth.revokeThread(threadId);
    const child = this.children.get(threadId);
    if (child) {
      child.kill();
      this.children.delete(threadId);
    }
  }

  async close(): Promise<void> {
    this.disposed = true;
    for (const child of this.children.values()) {
      child.kill();
    }
    this.children.clear();
    if (this.controlServer) {
      await new Promise<void>((resolve) => this.controlServer!.close(() => resolve()));
      this.controlServer = undefined;
    }
  }
}

export function mergeEcoBrowserSdkConfig(
  base: McpSdkConfig,
  injection: { enabled: boolean; sdkEntry?: Record<string, unknown>; autoApproveTools?: boolean },
): McpSdkConfig {
  if (!injection.enabled || !injection.sdkEntry) {
    return base;
  }
  const allowedTools =
    injection.autoApproveTools === false
      ? [...base.allowedTools]
      : [...new Set([...base.allowedTools, ECO_AGENT_BROWSER_ALLOWED_TOOL])];
  const nextServers = { ...base.mcpServers };
  // Drop any leftover eco_ab_* multi-name servers from older builds.
  for (const key of Object.keys(nextServers)) {
    if (key === ECO_AGENT_BROWSER_MCP_SERVER || key.startsWith("eco_ab_")) {
      delete nextServers[key];
    }
  }
  return {
    mcpServers: {
      ...nextServers,
      [ECO_AGENT_BROWSER_MCP_SERVER]: injection.sdkEntry,
    },
    allowedTools,
  };
}
