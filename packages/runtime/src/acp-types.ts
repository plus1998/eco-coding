import type { AcpJsonRpcPeer } from "./acp-jsonrpc.js";

export type AcpClientInfo = {
  name: string;
  version: string;
};

export type AcpClientCapabilities = Record<string, unknown>;

export type AcpAgentCapabilities = {
  loadSession?: boolean;
  mcpCapabilities?: Record<string, unknown>;
  promptCapabilities?: Record<string, unknown>;
  sessionCapabilities?: Record<string, unknown>;
  [key: string]: unknown;
};

export type AcpAuthMethod = {
  id: string;
  name: string;
  description?: string;
  [key: string]: unknown;
};

export type AcpInitializeResult = {
  protocolVersion: number;
  agentCapabilities?: AcpAgentCapabilities;
  authMethods?: AcpAuthMethod[];
  [key: string]: unknown;
};

export type AcpNewSessionResult = {
  sessionId: string;
  [key: string]: unknown;
};

export interface AcpClientOptions {
  peer: AcpJsonRpcPeer;
  clientInfo?: AcpClientInfo;
}

/** Locked method / notification names from local `agent acp` probe. */
export const ACP_PROTOCOL = {
  protocolVersion: 1,
  methods: {
    initialize: "initialize",
    sessionNew: "session/new",
    sessionLoad: "session/load",
    sessionDelete: "session/delete",
    sessionPrompt: "session/prompt",
  },
  /** Agent → client JSON-RPC requests (must be answered or the prompt turn hangs). */
  clientMethods: {
    sessionRequestPermission: "session/request_permission",
  },
  notifications: {
    initialized: "notifications/initialized",
    /** Outbound cancel — must be notify, not request. */
    sessionCancel: "session/cancel",
    /** Inbound agent → client updates. */
    sessionUpdate: "session/update",
  },
} as const;

export const ACP_LOAD_SESSION_UNSUPPORTED = "ACP_LOAD_SESSION_UNSUPPORTED";
export const ACP_SESSION_DELETE_UNSUPPORTED = "ACP_SESSION_DELETE_UNSUPPORTED";

/** Default handshake RPC timeout. `session/prompt` / `session/load` use ACP_TURN_TIMEOUT_MS. */
export const ACP_RPC_TIMEOUT_MS = 30_000;

/**
 * `session/prompt` stays open until the turn ends (tools + model).
 * Same order of magnitude as Codex RPC (local TTFT / long tool loops).
 */
export const ACP_TURN_TIMEOUT_MS = 15 * 60 * 1000;
