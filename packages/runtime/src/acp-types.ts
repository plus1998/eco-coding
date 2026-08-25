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

/** Cursor ACP session modes advertised by `session/new` (no debug). */
export type AcpSessionModeId = "agent" | "plan" | "ask";

export type AcpCreatePlanRequest = {
  toolCallId: string;
  name?: string;
  overview?: string;
  plan: string;
  todos?: unknown[];
  isProject?: boolean;
  phases?: unknown[];
  [key: string]: unknown;
};

export type AcpCreatePlanOutcome =
  | { outcome: "accepted"; planUri?: string }
  | { outcome: "rejected"; reason?: string }
  | { outcome: "cancelled" };

export type AcpAskQuestionRequest = {
  toolCallId: string;
  title?: string;
  questions: unknown[];
  [key: string]: unknown;
};

export type AcpAskQuestionOutcome =
  | {
      outcome: "answered";
      answers: Array<{ questionId: string; selectedOptionIds: string[] }>;
    }
  | { outcome: "skipped"; reason?: string }
  | { outcome: "cancelled" };

export type AcpCreatePlanHandler = (
  request: AcpCreatePlanRequest,
) => Promise<AcpCreatePlanOutcome> | AcpCreatePlanOutcome;

export type AcpAskQuestionHandler = (
  request: AcpAskQuestionRequest,
) => Promise<AcpAskQuestionOutcome> | AcpAskQuestionOutcome;

export type AcpPermissionOption = {
  optionId: string;
  name?: string;
  kind?: string;
};

export type AcpPermissionToolCall = {
  toolCallId: string;
  title?: string;
  kind?: string;
  rawInput?: Record<string, unknown>;
  locations?: unknown;
  [key: string]: unknown;
};

export type AcpPermissionRequest = {
  sessionId?: string;
  toolCall: AcpPermissionToolCall;
  options: AcpPermissionOption[];
};

export type AcpPermissionOutcome =
  | { outcome: { outcome: "selected"; optionId: string } }
  | { outcome: { outcome: "cancelled" } };

export type AcpPermissionHandler = (
  request: AcpPermissionRequest,
) => Promise<AcpPermissionOutcome> | AcpPermissionOutcome;

export type AcpTaskRequest = {
  toolCallId: string;
  title?: string;
  description?: string;
  prompt?: string;
  [key: string]: unknown;
};

export type AcpTaskOutcome =
  | { outcome: "accepted" }
  | { outcome: "rejected"; reason?: string }
  | { outcome: "cancelled" };

export type AcpTaskHandler = (request: AcpTaskRequest) => Promise<AcpTaskOutcome> | AcpTaskOutcome;

import type { AcpFsHandler } from "./acp-fs.js";

export interface AcpClientOptions {
  peer: AcpJsonRpcPeer;
  clientInfo?: AcpClientInfo;
  /** Required for Plan mode — without it create_plan is rejected (no silent auto-accept). */
  onCreatePlan?: AcpCreatePlanHandler;
  /** Optional; without it ask_question is skipped with an explicit reason. */
  onAskQuestion?: AcpAskQuestionHandler;
  /**
   * Eco host takes over `session/request_permission`.
   * Without it the client auto-allows so handshake probes / turns do not hang.
   */
  onRequestPermission?: AcpPermissionHandler;
  /**
   * Handles ACP `fs/read_text_file` / `fs/write_text_file` requests (workspace-scoped).
   * Without it the peer answers -32601, which makes subagent file operations fail
   * and can cause the agent to end the turn early.
   */
  fsHandler?: AcpFsHandler;
  /**
   * Handles `cursor/task` requests — Cursor host gets subagent details.
   * Without it the peer answers -32601, which may cause Cursor to treat the host
   * as not supporting subagent inspection.
   */
  onTask?: AcpTaskHandler;
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
    sessionSetMode: "session/set_mode",
    sessionSetModel: "session/set_model",
    sessionSetConfigOption: "session/set_config_option",
  },
  /** Agent → client JSON-RPC requests (must be answered or the prompt turn hangs). */
  clientMethods: {
    sessionRequestPermission: "session/request_permission",
    cursorCreatePlan: "cursor/create_plan",
    cursorAskQuestion: "cursor/ask_question",
    cursorTask: "cursor/task",
    fsReadTextFile: "fs/read_text_file",
    fsWriteTextFile: "fs/write_text_file",
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

/** Default handshake RPC timeout (`initialize`, `session/new`, …). */
export const ACP_RPC_TIMEOUT_MS = 30_000;

/**
 * Idle window for `session/prompt` / `session/load`.
 * Any inbound JSON-RPC message (session/update, permission request, …)
 * resets the timer. While Eco is answering an inbound request
 * (`session/request_permission`, `cursor/create_plan`, `cursor/ask_question`)
 * the idle clock is paused — approval wait is not a hang.
 * Silence longer than this after the agent is unblocked is treated as a hang.
 */
export const ACP_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
