import type { AcpJsonRpcPeer } from "./acp-jsonrpc.js";
import type { AcpMcpServer } from "./acp-mcp.js";
import { agentSupportsSessionDelete } from "./acp-session-delete.js";
import {
  parseAcpPermissionRequest,
  resolveAcpPermissionAutoAllow,
  resolveAcpPermissionReject,
} from "./acp-permission.js";
import {
  ACP_IDLE_TIMEOUT_MS,
  ACP_LOAD_SESSION_UNSUPPORTED,
  ACP_PROTOCOL,
  ACP_SESSION_DELETE_UNSUPPORTED,
  type AcpAskQuestionHandler,
  type AcpAskQuestionOutcome,
  type AcpAskQuestionRequest,
  type AcpClientInfo,
  type AcpClientOptions,
  type AcpCreatePlanHandler,
  type AcpCreatePlanOutcome,
  type AcpCreatePlanRequest,
  type AcpInitializeResult,
  type AcpNewSessionResult,
  type AcpPermissionHandler,
  type AcpPermissionOutcome,
  type AcpSessionModeId,
} from "./acp-types.js";

const DEFAULT_CLIENT_INFO: AcpClientInfo = {
  name: "eco",
  version: "0.0.0",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class AcpClient {
  private readonly peer: AcpJsonRpcPeer;
  private readonly clientInfo: AcpClientInfo;
  private readonly onCreatePlan: AcpCreatePlanHandler | undefined;
  private readonly onAskQuestion: AcpAskQuestionHandler | undefined;
  private readonly onRequestPermission: AcpPermissionHandler | undefined;
  private initializeResult: AcpInitializeResult | undefined;

  constructor(options: AcpClientOptions) {
    this.peer = options.peer;
    this.clientInfo = options.clientInfo ?? DEFAULT_CLIENT_INFO;
    this.onCreatePlan = options.onCreatePlan;
    this.onAskQuestion = options.onAskQuestion;
    this.onRequestPermission = options.onRequestPermission;
    this.peer.onRequest((request) => this.handleIncomingRequest(request));
  }

  async initialize(): Promise<AcpInitializeResult> {
    const result = await this.peer.request(ACP_PROTOCOL.methods.initialize, {
      protocolVersion: ACP_PROTOCOL.protocolVersion,
      // Empty fs/terminal capabilities: Cursor uses its own FS.
      // session/request_permission is answered by Eco (or auto-allow when no handler).
      clientCapabilities: {},
      clientInfo: this.clientInfo,
    });
    if (!isRecord(result) || typeof result.protocolVersion !== "number") {
      throw new Error("ACP initialize returned invalid result");
    }
    this.initializeResult = result as AcpInitializeResult;
    return this.initializeResult;
  }

  /** Send notifications/initialized */
  confInitialized(): void {
    this.peer.notify(ACP_PROTOCOL.notifications.initialized);
  }

  async newSession(input: {
    cwd: string;
    mcpServers?: readonly AcpMcpServer[];
  }): Promise<{ sessionId: string } & Record<string, unknown>> {
    const result = await this.peer.request(ACP_PROTOCOL.methods.sessionNew, {
      cwd: input.cwd,
      mcpServers: input.mcpServers ?? [],
    });
    if (!isRecord(result) || typeof result.sessionId !== "string") {
      throw new Error("ACP session/new returned no sessionId");
    }
    return { sessionId: result.sessionId, ...(result as AcpNewSessionResult) };
  }

  /**
   * Load an existing session.
   * Measured Cursor shape requires `mcpServers` (array); defaults to [].
   * Result includes `models` / `modes` (same shape as session/new) when the agent returns them.
   */
  async loadSession(input: {
    sessionId: string;
    cwd: string;
    mcpServers?: readonly AcpMcpServer[];
  }): Promise<Record<string, unknown>> {
    const caps = this.initializeResult?.agentCapabilities;
    if (!caps || caps.loadSession !== true) {
      throw new Error(
        `${ACP_LOAD_SESSION_UNSUPPORTED}: agent did not advertise loadSession: true`,
      );
    }
    try {
      const result = await this.peer.request(
        ACP_PROTOCOL.methods.sessionLoad,
        {
          sessionId: input.sessionId,
          cwd: input.cwd,
          mcpServers: input.mcpServers ?? [],
        },
        { idleTimeoutMs: ACP_IDLE_TIMEOUT_MS },
      );
      return isRecord(result) ? result : {};
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/method not found/i.test(message)) {
        throw new Error(
          `${ACP_LOAD_SESSION_UNSUPPORTED}: session/load not available (${message})`,
        );
      }
      throw error;
    }
  }

  async setMode(input: { sessionId: string; modeId: AcpSessionModeId }): Promise<void> {
    try {
      await this.peer.request(ACP_PROTOCOL.methods.sessionSetMode, {
        sessionId: input.sessionId,
        modeId: input.modeId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`session/set_mode modeId=${JSON.stringify(input.modeId)}: ${message}`);
    }
  }

  async setModel(input: { sessionId: string; modelId: string }): Promise<void> {
    try {
      await this.peer.request(ACP_PROTOCOL.methods.sessionSetModel, {
        sessionId: input.sessionId,
        modelId: input.modelId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`session/set_model modelId=${JSON.stringify(input.modelId)}: ${message}`);
    }
  }

  async prompt(input: { sessionId: string; prompt: unknown }): Promise<unknown> {
    return this.peer.request(
      ACP_PROTOCOL.methods.sessionPrompt,
      {
        sessionId: input.sessionId,
        prompt: input.prompt,
      },
      { idleTimeoutMs: ACP_IDLE_TIMEOUT_MS },
    );
  }

  /**
   * Cancel in-flight prompt work.
   * Measured: `session/cancel` is a JSON-RPC **notification** (request → -32601).
   */
  async cancel(input: { sessionId: string }): Promise<void> {
    this.peer.notify(ACP_PROTOCOL.notifications.sessionCancel, {
      sessionId: input.sessionId,
    });
  }

  async deleteSession(input: { sessionId: string }): Promise<void> {
    if (!agentSupportsSessionDelete(this.initializeResult ?? {})) {
      throw new Error(
        `${ACP_SESSION_DELETE_UNSUPPORTED}: agent did not advertise sessionCapabilities.delete`,
      );
    }
    await this.peer.request(ACP_PROTOCOL.methods.sessionDelete, {
      sessionId: input.sessionId,
    });
  }

  onSessionUpdate(handler: (params: unknown) => void): () => void {
    return this.peer.onNotification(ACP_PROTOCOL.notifications.sessionUpdate, handler);
  }

  private async handleIncomingRequest(request: {
    method: string;
    params?: unknown;
  }): Promise<unknown> {
    if (request.method === ACP_PROTOCOL.clientMethods.sessionRequestPermission) {
      return this.resolvePermission(request.params);
    }
    if (request.method === ACP_PROTOCOL.clientMethods.cursorCreatePlan) {
      return {
        outcome: await this.resolveCreatePlan(request.params),
      };
    }
    if (request.method === ACP_PROTOCOL.clientMethods.cursorAskQuestion) {
      return {
        outcome: await this.resolveAskQuestion(request.params),
      };
    }
    throw Object.assign(new Error(`Method not found: ${request.method}`), { code: -32601 });
  }

  private async resolvePermission(params: unknown): Promise<AcpPermissionOutcome> {
    if (!this.onRequestPermission) {
      return resolveAcpPermissionAutoAllow(params);
    }
    const parsed = parseAcpPermissionRequest(params);
    if (!parsed) {
      const rejected = resolveAcpPermissionReject(params);
      if (rejected) return rejected;
      throw new Error(
        "ACP session/request_permission missing toolCallId/options; Eco cannot take over approval",
      );
    }
    return this.onRequestPermission(parsed);
  }

  private async resolveCreatePlan(params: unknown): Promise<AcpCreatePlanOutcome> {
    const request = parseAcpCreatePlanRequest(params);
    if (!request) {
      return { outcome: "rejected", reason: "ACP cursor/create_plan missing toolCallId or plan" };
    }
    if (!this.onCreatePlan) {
      return {
        outcome: "rejected",
        reason: "Eco ACP host has no create_plan handler (plan approval not wired)",
      };
    }
    return this.onCreatePlan(request);
  }

  private async resolveAskQuestion(params: unknown): Promise<AcpAskQuestionOutcome> {
    const request = parseAcpAskQuestionRequest(params);
    if (!request) {
      return { outcome: "skipped", reason: "ACP cursor/ask_question missing toolCallId" };
    }
    if (!this.onAskQuestion) {
      return { outcome: "skipped", reason: "Eco ACP host has no ask_question handler" };
    }
    return this.onAskQuestion(request);
  }
}

export function parseAcpCreatePlanRequest(params: unknown): AcpCreatePlanRequest | undefined {
  if (!isRecord(params) || typeof params.toolCallId !== "string" || !params.toolCallId.trim()) {
    return undefined;
  }
  if (typeof params.plan !== "string") {
    return undefined;
  }
  return {
    ...params,
    toolCallId: params.toolCallId.trim(),
    plan: params.plan,
    ...(typeof params.name === "string" ? { name: params.name } : {}),
    ...(typeof params.overview === "string" ? { overview: params.overview } : {}),
  };
}

export function parseAcpAskQuestionRequest(params: unknown): AcpAskQuestionRequest | undefined {
  if (!isRecord(params) || typeof params.toolCallId !== "string" || !params.toolCallId.trim()) {
    return undefined;
  }
  return {
    ...params,
    toolCallId: params.toolCallId.trim(),
    questions: Array.isArray(params.questions) ? params.questions : [],
    ...(typeof params.title === "string" ? { title: params.title } : {}),
  };
}

export type { AcpClientOptions } from "./acp-types.js";
