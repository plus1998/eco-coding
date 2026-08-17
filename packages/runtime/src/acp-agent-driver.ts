import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { createAgentEvent, type AgentEvent } from "../../shared/src";
import { AcpClient } from "./acp-client.js";
import { mapAcpSessionUpdate } from "./acp-event-map.js";
import { AcpJsonRpcPeer } from "./acp-jsonrpc.js";
import {
  agentSupportsImagePrompt,
  buildAcpPromptBlocks,
  type AcpPromptImageAttachment,
} from "./acp-prompt.js";
import {
  cursorAcpSpawnError,
  resolveCursorAgentExecutable,
  spawnCursorAcpProcess,
} from "./acp-cursor-agent.js";
import type { AcpMcpServer } from "./acp-mcp.js";
import type { AcpAgentId } from "./core-runtime.js";
import {
  isAcpSessionModeId,
  parseAcpAvailableModels,
  resolveAcpWireModelId,
} from "./acp-session-config.js";
import type {
  AcpAskQuestionHandler,
  AcpCreatePlanHandler,
  AcpCreatePlanRequest,
  AcpSessionModeId,
} from "./acp-types.js";

/**
 * After cursor/create_plan is accepted, Cursor often ends the planning turn without
 * executing (HAPI #1097 / Cursor ACP dogfood). Eco must continue in the same session.
 */
export const ACP_PLAN_CONTINUE_PROMPT =
  "The user approved the plan. Implement it now with full Agent tools. Follow the approved plan toward the original request.";

export type AcpAgentRunInput = {
  threadId: string;
  prompt: string;
  workspacePath: string;
  signal?: AbortSignal;
  acpAgentId: AcpAgentId;
  resumeSessionId?: string;
  model?: string;
  sessionMode?: AcpSessionModeId;
  executable?: string;
  /** Extra env for the child (e.g. `{ CURSOR_API_KEY }`); merged over driver options env. */
  env?: NodeJS.ProcessEnv;
  attachments?: readonly AcpPromptImageAttachment[];
  /** Eco MCP servers mapped to ACP `session/new` / `session/load` `mcpServers`. */
  mcpServers?: readonly AcpMcpServer[];
  /** Plan mode: park cursor/create_plan until Eco plan approval resolves. */
  onCreatePlan?: AcpCreatePlanHandler;
  onAskQuestion?: AcpAskQuestionHandler;
  /** User prompt context for plan.ready payload. */
  userPromptForPlan?: string;
  /** Override plan→execute continue text (defaults to ACP_PLAN_CONTINUE_PROMPT). */
  planContinuePrompt?: string;
};

export type AcpAgentDriverOptions = {
  executable?: string;
  env?: NodeJS.ProcessEnv;
  spawnFn?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess;
};

type ActiveRun = {
  child: ChildProcess;
  peer?: AcpJsonRpcPeer;
  sessionId?: string;
  client?: AcpClient;
  /** Set by `cancel()` / AbortSignal so dispose/abort maps to cancelled, not failed. */
  cancelRequested?: boolean;
};

/**
 * Spawns Cursor `agent acp`, drives AcpClient over stdio, maps to AgentEvent.
 */
export class AcpAgentDriver {
  private readonly processes = new Map<string, ActiveRun>();

  constructor(private readonly options: AcpAgentDriverOptions = {}) {}

  async *run(input: AcpAgentRunInput): AsyncGenerator<AgentEvent> {
    if (input.acpAgentId !== "cursor") {
      yield createAgentEvent({
        id: `${input.threadId}:acp:unsupported`,
        threadId: input.threadId,
        agentId: "acp",
        role: "planner",
        type: "run.terminal",
        payload: {
          status: "failed",
          error: `Unsupported acpAgentId: ${String(input.acpAgentId)}`,
        },
      });
      return;
    }

    const sessionRunId = randomUUID();
    const sessionMode: AcpSessionModeId = isAcpSessionModeId(input.sessionMode)
      ? input.sessionMode
      : "agent";
    const executable = resolveCursorAgentExecutable(
      input.executable?.trim() || this.options.executable?.trim(),
      {
        env: { ...process.env, ...(this.options.env ?? {}), ...(input.env ?? {}) },
      },
    );
    const env = { ...this.options.env, ...input.env };
    const child = spawnCursorAcpProcess({
      executable,
      cwd: input.workspacePath,
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(this.options.spawnFn ? { spawnFn: this.options.spawnFn } : {}),
    });
    const spawnFailure = cursorAcpSpawnError(child);
    const active: ActiveRun = { child };
    this.processes.set(input.threadId, active);

    const queue: AgentEvent[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    const enqueue = (events: AgentEvent[]) => {
      if (events.length === 0) return;
      queue.push(...events);
      wake?.();
      wake = undefined;
    };

    const isCancelled = () =>
      Boolean(active.cancelRequested || input.signal?.aborted);

    const abort = () => {
      void this.cancel(input.threadId);
    };
    input.signal?.addEventListener("abort", abort, { once: true });

    let peer: AcpJsonRpcPeer | undefined;
    let readlineClosed = false;
    let unsubscribeUpdate: (() => void) | undefined;

    try {
      const requestedModel = input.model?.trim() || undefined;
      yield createAgentEvent({
        id: `${input.threadId}:acp:${sessionRunId}:agent_start`,
        threadId: input.threadId,
        agentId: sessionRunId,
        role: "planner",
        type: "agent.started",
        payload: {
          source: "acp",
          acpAgentId: input.acpAgentId,
          executable,
          sessionMode,
          ...(requestedModel ? { requestedModel } : {}),
        },
      });

      if (!child.stdin || !child.stdout) {
        throw new Error("ACP process requires piped stdin/stdout");
      }

      const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
      peer = new AcpJsonRpcPeer({
        write: (line) => {
          child.stdin!.write(line);
        },
        onLine: (cb) => {
          rl.on("line", cb);
        },
      });
      active.peer = peer;
      const closeRl = () => {
        if (readlineClosed) return;
        readlineClosed = true;
        rl.close();
      };
      child.once("exit", () => {
        peer?.dispose();
        closeRl();
      });

      let planAcceptedThisRun = false;
      const onCreatePlan: AcpCreatePlanHandler = async (request) => {
        enqueue([
          createAgentEvent({
            id: `${input.threadId}:acp:${sessionRunId}:plan_ready:${request.toolCallId}`,
            threadId: input.threadId,
            agentId: sessionRunId,
            role: "planner",
            type: "plan.ready",
            payload: buildAcpPlanReadyPayload(request, input),
          }),
        ]);
        if (!input.onCreatePlan) {
          return {
            outcome: "rejected" as const,
            reason: "Eco ACP host has no create_plan handler (plan approval not wired)",
          };
        }
        // Blocking contract: park until Eco UI resolves — do not end the run early.
        const outcome = await input.onCreatePlan(request);
        if (outcome.outcome === "accepted" && active.client && active.sessionId) {
          try {
            await active.client.setMode({ sessionId: active.sessionId, modeId: "agent" });
            planAcceptedThisRun = true;
          } catch (error) {
            enqueue([
              createAgentEvent({
                id: `${input.threadId}:acp:${sessionRunId}:mode_after_plan`,
                threadId: input.threadId,
                agentId: sessionRunId,
                role: "planner",
                type: "terminal.output",
                payload: {
                  source: "acp",
                  liveType: "acp.set_mode_after_plan_failed",
                  error: error instanceof Error ? error.message : String(error),
                },
              }),
            ]);
          }
        }
        return outcome;
      };

      const client = new AcpClient({
        peer,
        clientInfo: { name: "eco", version: "0.0.0" },
        onCreatePlan,
        ...(input.onAskQuestion ? { onAskQuestion: input.onAskQuestion } : {}),
      });
      active.client = client;

      const ctx = {
        threadId: input.threadId,
        agentId: sessionRunId,
        sessionRunId,
        tools: new Map<string, { tool_name: string; input: Record<string, unknown> }>(),
      };

      let suppressSessionUpdates = false;
      unsubscribeUpdate = client.onSessionUpdate((params) => {
        if (suppressSessionUpdates) return;
        enqueue(mapAcpSessionUpdate(params, ctx));
      });

      let initializeResult: Awaited<ReturnType<typeof client.initialize>> | undefined;
      const handshake = (async () => {
        initializeResult = await client.initialize();
        client.confInitialized();
      })();
      await Promise.race([handshake, spawnFailure]);
      if (!initializeResult) {
        throw new Error("ACP initialize returned no result");
      }

      let sessionId: string;
      let availableModels = parseAcpAvailableModels(undefined);
      const mcpServers = input.mcpServers ?? [];
      if (input.resumeSessionId?.trim()) {
        sessionId = input.resumeSessionId.trim();
        suppressSessionUpdates = true;
        try {
          const loaded = await client.loadSession({
            sessionId,
            cwd: input.workspacePath,
            mcpServers,
          });
          // Measured: session/load returns models/modes like session/new.
          availableModels = parseAcpAvailableModels(loaded);
        } finally {
          suppressSessionUpdates = false;
        }
      } else {
        const created = await client.newSession({
          cwd: input.workspacePath,
          mcpServers,
        });
        sessionId = created.sessionId;
        availableModels = parseAcpAvailableModels(created);
      }
      active.sessionId = sessionId;

      yield createAgentEvent({
        id: `${input.threadId}:acp:${sessionRunId}:session`,
        threadId: input.threadId,
        agentId: sessionRunId,
        role: "planner",
        type: "session.captured",
        payload: {
          source: "acp",
          acpAgentId: input.acpAgentId,
          sessionId,
          cwd: input.workspacePath,
        },
      });

      if (requestedModel) {
        const wireModelId = resolveAcpWireModelId(requestedModel, availableModels);
        await client.setModel({ sessionId, modelId: wireModelId });
      }
      await client.setMode({ sessionId, modeId: sessionMode });

      const promptWork = (async () => {
        try {
          const prompt = buildAcpPromptBlocks({
            prompt: input.prompt,
            imageSupported: agentSupportsImagePrompt(initializeResult),
            ...(input.attachments?.length ? { attachments: input.attachments } : {}),
          });
          const result = await client.prompt({
            sessionId,
            prompt,
          });
          enqueue(mapAcpSessionUpdate(result, ctx));

          // Cursor ACP: accept alone often ends the planning turn with no execution (HAPI #1097).
          // Same-session continue is the standard client handoff — not a Pi/Codex-style new run.
          if (planAcceptedThisRun && !isCancelled()) {
            planAcceptedThisRun = false;
            const continueText =
              input.planContinuePrompt?.trim() || ACP_PLAN_CONTINUE_PROMPT;
            enqueue([
              createAgentEvent({
                id: `${input.threadId}:acp:${sessionRunId}:plan_continue`,
                threadId: input.threadId,
                agentId: sessionRunId,
                role: "planner",
                type: "terminal.output",
                payload: {
                  source: "acp",
                  liveType: "acp.plan_continue",
                  prompt: continueText,
                },
              }),
            ]);
            try {
              await client.setMode({ sessionId, modeId: "agent" });
              const continueResult = await client.prompt({
                sessionId,
                prompt: buildAcpPromptBlocks({
                  prompt: continueText,
                  imageSupported: agentSupportsImagePrompt(initializeResult),
                }),
              });
              enqueue(mapAcpSessionUpdate(continueResult, ctx));
            } catch (continueError) {
              if (isCancelled()) {
                enqueue([
                  createAgentEvent({
                    id: `${input.threadId}:acp:${sessionRunId}:plan_continue_terminal`,
                    threadId: input.threadId,
                    agentId: sessionRunId,
                    role: "planner",
                    type: "run.terminal",
                    payload: { status: "cancelled", reason: "cancelled by user" },
                  }),
                ]);
              } else {
                enqueue([
                  createAgentEvent({
                    id: `${input.threadId}:acp:${sessionRunId}:plan_continue_terminal`,
                    threadId: input.threadId,
                    agentId: sessionRunId,
                    role: "planner",
                    type: "run.terminal",
                    payload: {
                      status: "failed",
                      error:
                        continueError instanceof Error
                          ? continueError.message
                          : String(continueError),
                    },
                  }),
                ]);
              }
            }
          }
        } catch (error) {
          if (isCancelled()) {
            enqueue([
              createAgentEvent({
                id: `${input.threadId}:acp:${sessionRunId}:terminal`,
                threadId: input.threadId,
                agentId: sessionRunId,
                role: "planner",
                type: "run.terminal",
                payload: { status: "cancelled", reason: "cancelled by user" },
              }),
            ]);
          } else {
            enqueue([
              createAgentEvent({
                id: `${input.threadId}:acp:${sessionRunId}:terminal`,
                threadId: input.threadId,
                agentId: sessionRunId,
                role: "planner",
                type: "run.terminal",
                payload: {
                  status: "failed",
                  error: error instanceof Error ? error.message : String(error),
                },
              }),
            ]);
          }
        } finally {
          finished = true;
          wake?.();
          wake = undefined;
        }
      })();

      while (!finished || queue.length > 0) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }
        if (finished) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }

      await promptWork;
      closeRl();
    } catch (error) {
      const cancelled = isCancelled();
      yield createAgentEvent({
        id: `${input.threadId}:acp:${sessionRunId}:terminal`,
        threadId: input.threadId,
        agentId: sessionRunId,
        role: "planner",
        type: "run.terminal",
        payload: {
          status: cancelled ? "cancelled" : "failed",
          ...(cancelled
            ? { reason: "cancelled by user" }
            : { error: error instanceof Error ? error.message : String(error) }),
        },
      });
    } finally {
      unsubscribeUpdate?.();
      peer?.dispose();
      input.signal?.removeEventListener("abort", abort);
      if (!child.killed) {
        try {
          child.kill("SIGTERM");
        } catch {
          // process may already be gone
        }
      }
      this.processes.delete(input.threadId);
    }
  }

  cancel(threadId: string): boolean {
    const active = this.processes.get(threadId);
    if (!active) return false;
    active.cancelRequested = true;
    if (active.sessionId && active.client) {
      try {
        void active.client.cancel({ sessionId: active.sessionId });
      } catch {
        // best-effort ACP cancel before kill
      }
    }
    active.peer?.dispose();
    try {
      active.child.kill("SIGINT");
    } catch {
      return false;
    }
    return true;
  }
}

function buildAcpPlanReadyPayload(
  request: AcpCreatePlanRequest,
  input: AcpAgentRunInput,
): {
  userPrompt: string;
  analysis: string;
  plan: string;
  deferredExitPlanToolUseId: string;
} {
  const overview =
    typeof request.overview === "string" && request.overview.trim()
      ? request.overview.trim()
      : typeof request.name === "string" && request.name.trim()
        ? request.name.trim()
        : "";
  return {
    userPrompt: (input.userPromptForPlan ?? input.prompt).trim() || input.prompt,
    analysis: overview,
    plan: request.plan,
    deferredExitPlanToolUseId: request.toolCallId,
  };
}
