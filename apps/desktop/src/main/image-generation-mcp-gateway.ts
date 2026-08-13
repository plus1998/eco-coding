import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { CodexMcpServerForConfigSync } from "@eco/runtime";
import {
  ECO_IMAGE_GENERATION_FULL_TOOL,
  ECO_IMAGE_GENERATION_MCP_SERVER,
  ECO_IMAGE_GENERATION_TOOL,
  ImageGenerationError,
  type ImageGenerationArtifact,
  type ImageGenerationToolInput,
  buildImageGenerationPromptAppend,
} from "../shared/image-generation";
import type { McpSdkConfig } from "../shared/mcp";
import { BrowserMcpAuthRegistry, createBrowserMcpControlSecret } from "./browser-mcp-auth";
import { BrowserMcpToolClaimRouter } from "./browser-mcp-router";
import { generateImagesToWorkspace, normalizeImageGenerationToolInput } from "./image-generation-client";
import type { ImageGenerationStore } from "./image-generation-store";

const require = createRequire(import.meta.url);

export interface ImageGenerationMcpInjection {
  enabled: boolean;
  serverName: typeof ECO_IMAGE_GENERATION_MCP_SERVER;
  sdkEntry?: Record<string, unknown>;
  codexServer?: CodexMcpServerForConfigSync;
  promptAppend?: string;
  unavailableReason?: string;
}

export interface ImageGenerationGatewayDeps {
  store: ImageGenerationStore;
  resolveWorkspacePath(threadId: string): string | undefined;
  resolveGenerationRoot(threadId: string): string | undefined;
  onArtifactChanged(artifact: ImageGenerationArtifact): void;
}

export class ImageGenerationMcpGateway {
  private readonly auth = new BrowserMcpAuthRegistry();
  private readonly claims = new BrowserMcpToolClaimRouter();
  private readonly controlSecret = createBrowserMcpControlSecret();
  private server: http.Server | undefined;
  private port: number | undefined;

  constructor(private readonly deps: ImageGenerationGatewayDeps) {}

  noteUpcomingTool(threadId: string, toolName?: string, toolUseId?: string): void {
    if (toolName?.includes(ECO_IMAGE_GENERATION_MCP_SERVER) || toolName?.includes(ECO_IMAGE_GENERATION_TOOL)) {
      this.claims.noteUpcoming(threadId, toolName, toolUseId);
    }
  }

  /** Stable process-global definition written to Codex config.toml. */
  async resolveGlobalCodexServer(): Promise<CodexMcpServerForConfigSync | undefined> {
    if (!this.deps.store.getSettings().enabled) {
      return undefined;
    }
    await this.start();
    const script = resolveStdioScriptPath();
    if (!fs.existsSync(script)) {
      throw new Error(`Image generation MCP stdio front-end not found: ${script}`);
    }
    return {
      name: ECO_IMAGE_GENERATION_MCP_SERVER,
      transport: "stdio",
      command: process.execPath,
      args: [script],
      env: {
        ECO_IMAGE_CONTROL_URL: this.controlBaseUrl,
        ECO_IMAGE_CONTROL_SECRET: this.controlSecret,
        ELECTRON_RUN_AS_NODE: "1",
      },
      enabledTools: [ECO_IMAGE_GENERATION_TOOL],
      startupTimeoutSec: 60,
    };
  }

  async resolveInjection(input: { threadId: string; sessionEnabled: boolean }): Promise<ImageGenerationMcpInjection> {
    const settings = this.deps.store.getSettings();
    if (!settings.enabled || !input.sessionEnabled) {
      return { enabled: false, serverName: ECO_IMAGE_GENERATION_MCP_SERVER };
    }
    try {
      const config = this.deps.store.getActiveClientConfig();
      const globalCodexServer = await this.resolveGlobalCodexServer();
      if (!globalCodexServer) {
        return { enabled: false, serverName: ECO_IMAGE_GENERATION_MCP_SERVER };
      }
      const auth = this.auth.ensure(input.threadId);
      const baseEnv = globalCodexServer.env ?? {};
      return {
        enabled: true,
        serverName: ECO_IMAGE_GENERATION_MCP_SERVER,
        sdkEntry: {
          type: "stdio",
          command: globalCodexServer.command ?? process.execPath,
          args: globalCodexServer.args ?? [],
          env: { ...baseEnv, ECO_IMAGE_AUTH_TOKEN: auth.token },
          alwaysLoad: true,
        },
        codexServer: globalCodexServer,
        promptAppend: buildImageGenerationPromptAppend(config),
      };
    } catch (error) {
      return {
        enabled: false,
        serverName: ECO_IMAGE_GENERATION_MCP_SERVER,
        unavailableReason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  mergeIntoSdkConfig(base: McpSdkConfig, injection: ImageGenerationMcpInjection): McpSdkConfig {
    if (!injection.enabled || !injection.sdkEntry) return base;
    return {
      mcpServers: { ...base.mcpServers, [ECO_IMAGE_GENERATION_MCP_SERVER]: injection.sdkEntry },
      // Intentionally omit from allowedTools: every call must reach Eco's approval UI.
      allowedTools: base.allowedTools.filter((tool) => tool !== ECO_IMAGE_GENERATION_FULL_TOOL),
    };
  }

  disposeThread(threadId: string): void {
    this.auth.revokeThread(threadId);
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
    if (!this.port) throw new Error("图片创建 MCP 控制服务尚未启动。");
    return `http://127.0.0.1:${this.port}`;
  }

  private resolveThread(authToken: string | undefined): { threadId: string; toolUseId?: string } {
    const authenticated = this.auth.resolve(authToken);
    if (authenticated) {
      const claimed = this.claims.claimDetails(
        ECO_IMAGE_GENERATION_TOOL,
        authenticated.threadId,
      );
      return {
        threadId: authenticated.threadId,
        ...(claimed?.toolUseId && { toolUseId: claimed.toolUseId }),
      };
    }
    const claimed = this.claims.claimDetails(ECO_IMAGE_GENERATION_TOOL);
    if (claimed) {
      return {
        threadId: claimed.threadId,
        ...(claimed.toolUseId && { toolUseId: claimed.toolUseId }),
      };
    }
    throw new Error("图片创建 MCP 无法绑定会话：缺少有效线程令牌或 tool.started claim。");
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (request.headers["x-eco-image-control-secret"] !== this.controlSecret) {
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
    const bearer = typeof request.headers.authorization === "string" && request.headers.authorization.toLowerCase().startsWith("bearer ")
      ? request.headers.authorization.slice(7).trim()
      : undefined;
    const authToken = typeof body.authToken === "string" ? body.authToken : bearer;
    try {
      if (request.url === "/v1/tools/list") {
        sendJson(response, 200, { tools: [imageGenerationToolDefinition()] });
        return;
      }
      if (request.url !== "/v1/tools/call") {
        sendJson(response, 404, { error: "not found" });
        return;
      }
      if (body.name !== ECO_IMAGE_GENERATION_TOOL) throw new Error(`未知图片创建工具：${String(body.name)}`);
      const claim = this.resolveThread(authToken);
      const threadId = claim.threadId;
      const workspacePath = this.deps.resolveWorkspacePath(threadId)?.trim();
      const generationRoot = this.deps.resolveGenerationRoot(threadId)?.trim();
      if (!workspacePath || !generationRoot) throw new Error("图片创建会话缺少 workspace 或运行目录。");
      const rawArgs = isRecord(body.arguments) ? body.arguments : {};
      const config = this.deps.store.getActiveClientConfig();
      const normalized = normalizeImageGenerationToolInput(rawArgs as unknown as ImageGenerationToolInput, config.provider);
      const { prompt, ...parameters } = normalized;
      const artifact = this.deps.store.createArtifact({
        threadId,
        ...(claim.toolUseId && { toolUseId: claim.toolUseId }),
        prompt,
        parameters,
        config,
        workspacePath,
        generationRoot,
      });
      this.deps.onArtifactChanged(artifact);
      try {
        const images = await generateImagesToWorkspace({
          config,
          toolInput: normalized,
          generationRoot,
          threadDirectory: threadDirectoryName(threadId),
        });
        const completed = this.deps.store.completeArtifact(artifact.id, images);
        this.deps.onArtifactChanged(completed);
        sendJson(response, 200, {
          result: {
            content: [{ type: "text", text: JSON.stringify({ status: "completed", artifactId: artifact.id, images }, null, 2) }],
            structuredContent: { status: "completed", artifactId: artifact.id, provider: config.provider, model: config.model, images },
          },
        });
      } catch (error) {
        const failure = error instanceof ImageGenerationError
          ? error
          : new ImageGenerationError("internal_error", error instanceof Error ? error.message : String(error));
        const failed = this.deps.store.failArtifact(artifact.id, failure.code, failure.message, failure.partialImages);
        this.deps.onArtifactChanged(failed);
        sendJson(response, 200, {
          result: {
            content: [{ type: "text", text: JSON.stringify({
              status: "failed",
              artifactId: artifact.id,
              code: failure.code,
              message: failure.message,
              ...(failure.providerStatus ? { providerStatus: failure.providerStatus } : {}),
              ...(failure.requestId ? { requestId: failure.requestId } : {}),
              partialImages: failure.partialImages,
            }, null, 2) }],
            isError: true,
            structuredContent: { status: "failed", artifactId: artifact.id, code: failure.code, message: failure.message, partialImages: failure.partialImages },
          },
        });
      }
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

function resolveStdioScriptPath(): string {
  const candidates = [
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../packaging/eco-image-generation-mcp-stdio.mjs"),
    path.join(process.cwd(), "apps/desktop/packaging/eco-image-generation-mcp-stdio.mjs"),
    path.join(process.cwd(), "packaging/eco-image-generation-mcp-stdio.mjs"),
  ];
  try {
    const electron = require("electron") as { app?: { getAppPath?: () => string } };
    if (electron.app?.getAppPath) candidates.unshift(path.join(electron.app.getAppPath(), "packaging/eco-image-generation-mcp-stdio.mjs"));
    if (typeof process.resourcesPath === "string") candidates.unshift(path.join(process.resourcesPath, "eco-image-generation-mcp-stdio.mjs"));
  } catch {
    // Tests run without Electron.
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]!;
}

function imageGenerationToolDefinition(): Record<string, unknown> {
  return {
    name: ECO_IMAGE_GENERATION_TOOL,
    description: "Create images with Eco's active image provider and save them into the current conversation work directory. Every call requires user approval.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        prompt: { type: "string", minLength: 1, maxLength: 32000 },
        size: { type: "string", description: "OpenAI: auto or WIDTHxHEIGHT; Gemini: 1K, 2K, or 4K." },
        aspect_ratio: { type: "string", description: "Gemini only, for example 1:1 or 16:9." },
        quality: { type: "string", enum: ["auto", "low", "medium", "high"], description: "OpenAI-style providers only." },
        count: { type: "integer", minimum: 1, maximum: 4, default: 1 },
        output_name: { type: "string", minLength: 1, maxLength: 80, description: "Safe filename prefix, never a path." },
      },
    },
  };
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

function threadDirectoryName(threadId: string): string {
  let hash = 0x811c9dc5;
  for (const char of threadId) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `thread-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
