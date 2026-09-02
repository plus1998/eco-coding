import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CodexMcpServerForConfigSync } from "@eco/runtime";
import {
  ECO_IMAGE_VIEW_FULL_TOOL,
  ECO_IMAGE_VIEW_MCP_SERVER,
  ECO_IMAGE_VIEW_TOOL,
  isEcoImageViewToolName,
} from "@eco/runtime";
import { buildImageViewPromptAppend } from "../shared/image-view-tool";
import type { McpSdkConfig } from "../shared/mcp";
import { BrowserMcpAuthRegistry, createBrowserMcpControlSecret } from "./browser-mcp-auth";
import { BrowserMcpToolClaimRouter } from "./browser-mcp-router";
import { ImageViewReadError, type ImageViewReadFailureCode, readImageViewFile } from "./image-view-reader";

const require = createRequire(import.meta.url);

const IMAGE_VIEW_READ_ERRORS: Record<ImageViewReadFailureCode, string> = {
  invalid_path: "图片路径不是有效的绝对路径。",
  not_found: "文件不存在，或该路径属于远程执行环境，Desktop 无法直接读取。",
  symbolic_link: "为避免读取目标不明确，图片预览不接受符号链接。",
  not_file: "该路径不是常规文件。",
  too_large: "图片超过 20 MB，无法在 Feed 中预览。",
  unsupported_type: "文件内容不是受支持的 PNG、JPEG、GIF 或 WebP 图片。",
};

export interface ImageViewMcpInjection {
  enabled: true;
  serverName: typeof ECO_IMAGE_VIEW_MCP_SERVER;
  sdkEntry: Record<string, unknown>;
  codexServer: CodexMcpServerForConfigSync;
  promptAppend: string;
}

export interface ImageViewAnalyzeInput {
  threadId: string;
  path: string;
  question?: string;
  toolUseId?: string;
}

export class ImageViewMcpGateway {
  private readonly auth = new BrowserMcpAuthRegistry();
  private readonly claims = new BrowserMcpToolClaimRouter();
  private readonly controlSecret = createBrowserMcpControlSecret();
  private readonly threadPrompts = new Map<string, string>();
  private server: http.Server | undefined;
  private port: number | undefined;

  constructor(private readonly deps: { analyze(input: ImageViewAnalyzeInput): Promise<string> }) {}

  noteUpcomingTool(threadId: string, toolName?: string, toolUseId?: string): void {
    if (isEcoImageViewToolName(toolName) || toolName?.trim() === ECO_IMAGE_VIEW_TOOL) {
      this.claims.noteUpcoming(threadId, toolName, toolUseId);
    }
  }

  noteThreadPrompt(threadId: string, prompt: string): void {
    const tid = threadId.trim();
    if (!tid) return;
    this.threadPrompts.set(tid, prompt);
  }

  async resolveGlobalCodexServer(): Promise<CodexMcpServerForConfigSync> {
    await this.start();
    const script = resolveStdioScriptPath();
    if (!fs.existsSync(script)) {
      throw new Error(`Image view MCP stdio front-end not found: ${script}`);
    }
    return {
      name: ECO_IMAGE_VIEW_MCP_SERVER,
      transport: "stdio",
      command: process.execPath,
      args: [script],
      env: {
        ECO_IMAGE_VIEW_CONTROL_URL: this.controlBaseUrl,
        ECO_IMAGE_VIEW_CONTROL_SECRET: this.controlSecret,
        ELECTRON_RUN_AS_NODE: "1",
      },
      enabledTools: [ECO_IMAGE_VIEW_TOOL],
      startupTimeoutSec: 60,
    };
  }

  async resolveInjection(threadId: string): Promise<ImageViewMcpInjection> {
    const globalCodexServer = await this.resolveGlobalCodexServer();
    const auth = this.auth.ensure(threadId);
    const baseEnv = globalCodexServer.env ?? {};
    return {
      enabled: true,
      serverName: ECO_IMAGE_VIEW_MCP_SERVER,
      sdkEntry: {
        type: "stdio",
        command: globalCodexServer.command ?? process.execPath,
        args: globalCodexServer.args ?? [],
        env: { ...baseEnv, ECO_IMAGE_VIEW_AUTH_TOKEN: auth.token },
        alwaysLoad: true,
      },
      codexServer: globalCodexServer,
      promptAppend: buildImageViewPromptAppend(),
    };
  }

  mergeIntoSdkConfig(base: McpSdkConfig, injection: ImageViewMcpInjection): McpSdkConfig {
    return {
      mcpServers: { ...base.mcpServers, [ECO_IMAGE_VIEW_MCP_SERVER]: injection.sdkEntry },
      allowedTools: [...new Set([...base.allowedTools, ECO_IMAGE_VIEW_FULL_TOOL])],
    };
  }

  disposeThread(threadId: string): void {
    this.auth.revokeThread(threadId);
    this.threadPrompts.delete(threadId.trim());
  }

  async close(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
    this.port = undefined;
  }

  private async start(): Promise<void> {
    if (this.server) return;
    this.server = http.createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolve, reject) => {
      this.server!.listen(0, "127.0.0.1", resolve);
      this.server!.once("error", reject);
    });
    this.port = (this.server.address() as AddressInfo).port;
  }

  private get controlBaseUrl(): string {
    if (!this.port) throw new Error("看图 MCP 控制服务尚未启动。");
    return `http://127.0.0.1:${this.port}`;
  }

  private resolveThread(authToken: string | undefined): { threadId: string; toolUseId?: string } {
    const authenticated = this.auth.resolve(authToken);
    if (authenticated) {
      const claimed = this.claims.claimDetails(ECO_IMAGE_VIEW_TOOL, authenticated.threadId);
      return {
        threadId: authenticated.threadId,
        ...(claimed?.toolUseId && { toolUseId: claimed.toolUseId }),
      };
    }
    const claimed = this.claims.claimDetails(ECO_IMAGE_VIEW_TOOL);
    if (claimed) {
      return {
        threadId: claimed.threadId,
        ...(claimed.toolUseId && { toolUseId: claimed.toolUseId }),
      };
    }
    throw new Error("看图 MCP 无法绑定会话：缺少有效线程令牌或 tool.started claim。");
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (request.headers["x-eco-image-view-control-secret"] !== this.controlSecret) {
      sendJson(response, 401, { error: "unauthorized control secret" });
      return;
    }
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    const body = await readJsonBody(request).catch((error) => ({ __error: String(error) }));
    if ("__error" in body) {
      sendJson(response, 400, { error: body.__error });
      return;
    }
    const bearer =
      typeof request.headers.authorization === "string" &&
      request.headers.authorization.toLowerCase().startsWith("bearer ")
        ? request.headers.authorization.slice(7).trim()
        : undefined;
    const authToken = typeof body.authToken === "string" ? body.authToken : bearer;
    try {
      if (request.url === "/v1/tools/list") {
        sendJson(response, 200, { tools: [imageViewToolDefinition()] });
        return;
      }
      if (request.url !== "/v1/tools/call") {
        sendJson(response, 404, { error: "not found" });
        return;
      }
      if (body.name !== ECO_IMAGE_VIEW_TOOL) {
        throw new Error(`未知看图工具：${String(body.name)}`);
      }
      const claim = this.resolveThread(authToken);
      const rawArgs = isRecord(body.arguments) ? body.arguments : {};
      const imagePath = typeof rawArgs.path === "string" ? rawArgs.path.trim() : "";
      const question = typeof rawArgs.question === "string" ? rawArgs.question.trim() : "";
      if (!imagePath || !path.isAbsolute(imagePath)) {
        sendJson(response, 200, {
          result: mcpErrorResult(IMAGE_VIEW_READ_ERRORS.invalid_path, "invalid_path"),
        });
        return;
      }
      let file;
      try {
        file = await readImageViewFile(imagePath);
      } catch (error) {
        if (error instanceof ImageViewReadError) {
          sendJson(response, 200, {
            result: mcpErrorResult(IMAGE_VIEW_READ_ERRORS[error.code], error.code),
          });
          return;
        }
        throw error;
      }
      void file;
      const fallbackPrompt = this.threadPrompts.get(claim.threadId)?.trim() ?? "";
      const report = await this.deps.analyze({
        threadId: claim.threadId,
        path: imagePath,
        ...(question ? { question } : fallbackPrompt ? { question: fallbackPrompt } : {}),
        ...(claim.toolUseId && { toolUseId: claim.toolUseId }),
      });
      sendJson(response, 200, {
        result: {
          content: [{ type: "text", text: report }],
        },
      });
    } catch (error) {
      sendJson(response, 200, {
        result: mcpErrorResult(error instanceof Error ? error.message : String(error), "analyze_failed"),
      });
    }
  }
}

function mcpErrorResult(message: string, code: string): Record<string, unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify({ status: "failed", code, message }) }],
    isError: true,
  };
}

function imageViewToolDefinition(): Record<string, unknown> {
  return {
    name: ECO_IMAGE_VIEW_TOOL,
    description:
      "Analyze a local image file with Eco's vision model and return a structured text report. path must be an absolute filesystem path.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: "string", minLength: 1, description: "Absolute local image path." },
        question: { type: "string", description: "Optional question to answer about the image." },
      },
    },
  };
}

function resolveStdioScriptPath(): string {
  const candidates = [
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../packaging/eco-image-view-mcp-stdio.mjs"),
    path.join(process.cwd(), "apps/desktop/packaging/eco-image-view-mcp-stdio.mjs"),
    path.join(process.cwd(), "packaging/eco-image-view-mcp-stdio.mjs"),
  ];
  try {
    const electron = require("electron") as { app?: { getAppPath?: () => string } };
    if (electron.app?.getAppPath) {
      candidates.unshift(path.join(electron.app.getAppPath(), "packaging/eco-image-view-mcp-stdio.mjs"));
    }
    if (typeof process.resourcesPath === "string") {
      candidates.unshift(path.join(process.resourcesPath, "eco-image-view-mcp-stdio.mjs"));
    }
  } catch {
    // Tests run without Electron.
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]!;
}

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > 1024 * 1024) throw new Error("request too large");
    chunks.push(bytes);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
  if (!isRecord(parsed)) throw new Error("invalid json object");
  return parsed;
}

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
