import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { createAgentEvent, type AgentEvent } from "../../shared/src";
import { AcpClient } from "./acp-client.js";
import { mapAcpSessionUpdate } from "./acp-event-map.js";
import { AcpJsonRpcPeer } from "./acp-jsonrpc.js";
import {
  cursorAcpSpawnError,
  resolveCursorAgentExecutable,
  spawnCursorAcpProcess,
} from "./acp-cursor-agent.js";
import type { AcpAgentId } from "./core-runtime.js";

const MODEL_GAP =
  "ACP session/prompt has no model parameter; requested model ignored";

export type AcpAgentRunInput = {
  threadId: string;
  prompt: string;
  workspacePath: string;
  signal?: AbortSignal;
  acpAgentId: AcpAgentId;
  resumeSessionId?: string;
  model?: string;
  executable?: string;
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
    const executable = resolveCursorAgentExecutable(
      input.executable?.trim() || this.options.executable?.trim(),
      {
        ...(this.options.env ? { env: this.options.env } : {}),
      },
    );
    const child = spawnCursorAcpProcess({
      executable,
      cwd: input.workspacePath,
      ...(this.options.env ? { env: this.options.env } : {}),
      ...(this.options.spawnFn ? { spawnFn: this.options.spawnFn } : {}),
    });
    // Register synchronously: the async `error` event (ENOENT when Cursor is
    // not installed) must be observed before it can be emitted.
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
          ...(requestedModel
            ? { requestedModel, modelGap: MODEL_GAP }
            : {}),
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

      const client = new AcpClient({
        peer,
        clientInfo: { name: "eco", version: "0.0.0" },
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

      // Race against the child's `error` event: when Cursor is not installed
      // the spawn fails async (ENOENT) and initialize would otherwise hang.
      const handshake = (async () => {
        await client.initialize();
        client.confInitialized();
      })();
      await Promise.race([handshake, spawnFailure]);

      let sessionId: string;
      if (input.resumeSessionId?.trim()) {
        sessionId = input.resumeSessionId.trim();
        // session/load MUST replay history as session/update (ACP v1). Eco already
        // has that history in the thread projection — do not append it again.
        suppressSessionUpdates = true;
        try {
          await client.loadSession({
            sessionId,
            cwd: input.workspacePath,
          });
        } finally {
          suppressSessionUpdates = false;
        }
      } else {
        const created = await client.newSession({ cwd: input.workspacePath });
        sessionId = created.sessionId;
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

      const promptWork = (async () => {
        try {
          const result = await client.prompt({
            sessionId,
            prompt: [{ type: "text", text: input.prompt }],
          });
          enqueue(mapAcpSessionUpdate(result, ctx));
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
    // Reject in-flight JSON-RPC so run() does not hang on request timeouts.
    active.peer?.dispose();
    try {
      active.child.kill("SIGINT");
    } catch {
      return false;
    }
    return true;
  }
}
