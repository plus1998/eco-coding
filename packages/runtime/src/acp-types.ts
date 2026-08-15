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
    sessionPrompt: "session/prompt",
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
