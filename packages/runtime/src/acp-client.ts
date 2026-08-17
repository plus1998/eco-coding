import type { AcpJsonRpcPeer } from "./acp-jsonrpc.js";
import { agentSupportsSessionDelete } from "./acp-session-delete.js";
import {
  ACP_LOAD_SESSION_UNSUPPORTED,
  ACP_PROTOCOL,
  ACP_SESSION_DELETE_UNSUPPORTED,
  ACP_TURN_TIMEOUT_MS,
  type AcpClientInfo,
  type AcpClientOptions,
  type AcpInitializeResult,
  type AcpNewSessionResult,
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
  private initializeResult: AcpInitializeResult | undefined;

  constructor(options: AcpClientOptions) {
    this.peer = options.peer;
    this.clientInfo = options.clientInfo ?? DEFAULT_CLIENT_INFO;
    this.peer.onRequest((request) => this.handleIncomingRequest(request));
  }

  async initialize(): Promise<AcpInitializeResult> {
    const result = await this.peer.request(ACP_PROTOCOL.methods.initialize, {
      protocolVersion: ACP_PROTOCOL.protocolVersion,
      // Empty fs/terminal capabilities: Cursor uses its own FS. Permission
      // requests are still answered (auto-allow) so prompt turns do not hang.
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
    mcpServers?: unknown[];
  }): Promise<{ sessionId: string }> {
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
   */
  async loadSession(input: {
    sessionId: string;
    cwd: string;
    mcpServers?: unknown[];
  }): Promise<void> {
    const caps = this.initializeResult?.agentCapabilities;
    if (!caps || caps.loadSession !== true) {
      throw new Error(
        `${ACP_LOAD_SESSION_UNSUPPORTED}: agent did not advertise loadSession: true`,
      );
    }
    try {
      await this.peer.request(
        ACP_PROTOCOL.methods.sessionLoad,
        {
          sessionId: input.sessionId,
          cwd: input.cwd,
          mcpServers: input.mcpServers ?? [],
        },
        ACP_TURN_TIMEOUT_MS,
      );
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

  async prompt(input: { sessionId: string; prompt: unknown }): Promise<unknown> {
    return this.peer.request(
      ACP_PROTOCOL.methods.sessionPrompt,
      {
        sessionId: input.sessionId,
        prompt: input.prompt,
      },
      ACP_TURN_TIMEOUT_MS,
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

  private handleIncomingRequest(request: { method: string; params?: unknown }): unknown {
    if (request.method === ACP_PROTOCOL.clientMethods.sessionRequestPermission) {
      return resolveAcpPermissionAutoAllow(request.params);
    }
    throw Object.assign(new Error(`Method not found: ${request.method}`), { code: -32601 });
  }
}

/** MVP: no approval UI yet — auto-select allow_once / allow_always so the turn is not stalled. */
export function resolveAcpPermissionAutoAllow(params: unknown): {
  outcome: { outcome: "selected"; optionId: string };
} {
  const options = isRecord(params) && Array.isArray(params.options) ? params.options : [];
  const allow = options.find(
    (option) =>
      isRecord(option) &&
      typeof option.optionId === "string" &&
      (option.kind === "allow_once" || option.kind === "allow_always"),
  );
  if (allow && isRecord(allow) && typeof allow.optionId === "string") {
    return { outcome: { outcome: "selected", optionId: allow.optionId } };
  }
  const first = options.find((option) => isRecord(option) && typeof option.optionId === "string");
  if (first && isRecord(first) && typeof first.optionId === "string") {
    return { outcome: { outcome: "selected", optionId: first.optionId } };
  }
  throw new Error("ACP session/request_permission had no selectable option");
}

export type { AcpClientOptions } from "./acp-types.js";
