import type { CodexAppServerClient } from "./codex-app-server-client.js";

export const CODEX_RESUME_METHOD = "thread/resume";
export const CODEX_THREAD_READ_METHOD = "thread/read";

export interface CodexThreadResumeInput {
  threadId: string;
  cwd?: string;
  model?: string;
  modelProvider?: string;
  /** Official thread/resume config layer; reapplies thread/actor MCP policy. */
  config?: Record<string, unknown>;
  /** Same app-server client already created this thread with the exact config. */
  configAlreadyApplied?: boolean;
}

export interface CodexThreadResumeParams {
  threadId: string;
  cwd?: string;
  model?: string;
  modelProvider?: string;
  config?: Record<string, unknown>;
}

export interface CodexThreadResumeResult {
  thread: {
    id: string;
    status?: CodexThreadStatusPayload;
    parentThreadId?: string | null;
    agentRole?: string | null;
  };
}

export interface CodexThreadReadParams {
  threadId: string;
  includeTurns?: boolean;
}

export interface CodexThreadReadResult {
  thread: {
    id: string;
    status?: CodexThreadStatusPayload;
  };
}

/** App-server `ThreadStatus` (tag = type). */
export type CodexThreadStatusPayload =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags?: string[] };

export type CodexThreadStatusKind = "notLoaded" | "idle" | "systemError" | "active" | "unknown";

export interface CodexResumeNotAvailableOptions {
  nextAction: string;
  cause?: unknown;
}

export class CodexResumeNotAvailable extends Error {
  readonly code = "CodexResumeNotAvailable";
  readonly nextAction: string;

  constructor(message: string, options: CodexResumeNotAvailableOptions) {
    super(`${message} Next action: ${options.nextAction}`, { cause: options.cause });
    this.name = "CodexResumeNotAvailable";
    this.nextAction = options.nextAction;
  }
}

export function buildCodexThreadResumeParams(input: CodexThreadResumeInput): CodexThreadResumeParams {
  const threadId = input.threadId.trim();
  if (!threadId) {
    throw new CodexResumeNotAvailable("Codex resume requires a thread id.", {
      nextAction: "Persist a Codex thread id via eco_thread_codex_map / attribution, then retry resume.",
    });
  }
  const params: CodexThreadResumeParams = { threadId };
  const cwd = input.cwd?.trim();
  const model = input.model?.trim();
  const modelProvider = input.modelProvider?.trim();
  if (cwd) {
    params.cwd = cwd;
  }
  if (model) {
    params.model = model;
  }
  if (modelProvider) {
    params.modelProvider = modelProvider;
  }
  if (input.config) {
    params.config = input.config;
  }
  return params;
}

export async function resumeCodexThread(
  client: Pick<CodexAppServerClient, "request">,
  input: CodexThreadResumeInput,
): Promise<CodexThreadResumeResult> {
  const params = buildCodexThreadResumeParams(input);
  if (params.config) {
    const status = await readCodexThreadStatus(client, params.threadId);
    if (status === "idle" && input.configAlreadyApplied) {
      delete params.config;
    } else {
      requireColdCodexThreadForConfigReload(params.threadId, status);
    }
  }
  return client.request<CodexThreadResumeResult>(CODEX_RESUME_METHOD, params);
}

/**
 * Codex 0.142.5 can return success after an idle unsubscribe even when its
 * internal shutdown timed out and resume overrides were ignored. Only the
 * protocol-visible `notLoaded` state proves a cold config reload.
 */
export async function prepareLoadedCodexThreadForConfigReload(
  client: Pick<CodexAppServerClient, "request">,
  threadId: string,
): Promise<"notLoaded"> {
  const status = await readCodexThreadStatus(client, threadId);
  return requireColdCodexThreadForConfigReload(threadId, status);
}

function requireColdCodexThreadForConfigReload(threadId: string, status: CodexThreadStatusKind): "notLoaded" {
  if (status === "notLoaded") {
    return "notLoaded";
  }
  throw new CodexResumeNotAvailable(
    `Codex cannot prove resume config reload while thread '${threadId}' is ${status}.`,
    {
      nextAction:
        "Restart the Codex app-server so the thread is notLoaded, then retry the configured resume.",
    },
  );
}

export async function readCodexThreadStatus(
  client: Pick<CodexAppServerClient, "request">,
  threadId: string,
): Promise<CodexThreadStatusKind> {
  const trimmed = threadId.trim();
  if (!trimmed) {
    throw new CodexResumeNotAvailable("Codex thread status requires a thread id.", {
      nextAction: "Pass a persisted Codex thread id from eco_thread_codex_map.",
    });
  }
  const result = await client.request<CodexThreadReadResult>(CODEX_THREAD_READ_METHOD, {
    threadId: trimmed,
    includeTurns: false,
  } satisfies CodexThreadReadParams);
  return parseCodexThreadStatus(result.thread?.status);
}

export function parseCodexThreadStatus(status: unknown): CodexThreadStatusKind {
  if (!isRecord(status) || typeof status.type !== "string") {
    return "unknown";
  }
  switch (status.type) {
    case "notLoaded":
    case "idle":
    case "systemError":
    case "active":
      return status.type;
    default:
      return "unknown";
  }
}

/** Terminal statuses: no in-flight turn Eco can reattach to. */
export function isCodexThreadStatusTerminal(kind: CodexThreadStatusKind): boolean {
  return kind === "idle" || kind === "systemError" || kind === "notLoaded" || kind === "unknown";
}

/**
 * Subagent agentId is the Codex child thread id (spawn / thread/started).
 * Resume requires a persisted attribution record — never invent a new thread.
 */
export function requireCodexSubagentThreadId(
  getThreadAttribution: (
    codexThreadId: string,
  ) => { parentThreadId: string; agentRole?: string | undefined } | undefined,
  agentId: string,
): string {
  const codexThreadId = agentId.trim();
  if (!codexThreadId) {
    throw new CodexResumeNotAvailable(
      "Codex subagent resume is not available because the agent id is missing.",
      {
        nextAction: "Resume from a subagent that has a persisted Codex child thread id.",
      },
    );
  }
  const attribution = getThreadAttribution(codexThreadId);
  if (!attribution?.parentThreadId?.trim() || !attribution.agentRole?.trim()) {
    throw new CodexResumeNotAvailable(
      "Codex subagent resume is not available because this agent has no Codex thread attribution mapping.",
      {
        nextAction:
          "Spawn the subagent once so Eco can persist codex_thread_attribution, then retry resume against the same agent id.",
      },
    );
  }
  return codexThreadId;
}

/**
 * Follow-up prompt for a resumed subagent thread (Codex multi-agent followup_task boundary).
 * Does not use Claude-style "Resume agent {id}" tool text.
 */
export function buildCodexSubagentFollowupPrompt(agentId: string, task: string): string {
  const trimmedTask = task.trim() || "Continue the previous task from where you left off.";
  const id = agentId.trim();
  if (!id) {
    return trimmedTask;
  }
  return `followup_task for agent ${id}: ${trimmedTask}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
