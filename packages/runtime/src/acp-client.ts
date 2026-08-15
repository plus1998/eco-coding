import type { AcpJsonRpcPeer } from "./acp-jsonrpc.js";
import {
  ACP_LOAD_SESSION_UNSUPPORTED,
  ACP_PROTOCOL,
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
  }

  async initialize(): Promise<AcpInitializeResult> {
    const result = await this.peer.request(ACP_PROTOCOL.methods.initialize, {
      protocolVersion: ACP_PROTOCOL.protocolVersion,
      // Prefer empty capabilities so agent won't send unhandled client requests
      // (AcpJsonRpcPeer has no onRequest yet).
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
      await this.peer.request(ACP_PROTOCOL.methods.sessionLoad, {
        sessionId: input.sessionId,
        cwd: input.cwd,
        mcpServers: input.mcpServers ?? [],
      });
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
    return this.peer.request(ACP_PROTOCOL.methods.sessionPrompt, {
      sessionId: input.sessionId,
      prompt: input.prompt,
    });
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

  onSessionUpdate(handler: (params: unknown) => void): () => void {
    return this.peer.onNotification(ACP_PROTOCOL.notifications.sessionUpdate, handler);
  }
}

export type { AcpClientOptions } from "./acp-types.js";
