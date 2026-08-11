import type { ResolvedModelRoute } from "../../model-router/src";
import { type AgentEvent, createAgentEvent } from "../../shared/src";
import type { AgentRuntimeDriver, AgentRuntimeRunInput } from "./index.js";
import { mapPiSessionEventToAgentEvents, type PiSessionEventLike, createPiEventAdapterState } from "./pi-event-adapter.js";
import { type BuildEcoPiModelInput, type EcoPiModelSpec, buildEcoPiModel, resolvePiPlannerRoute } from "./pi-model-bridge.js";

export interface PiSessionHandle {
  sessionId: string;
  cwd: string;
  prompt: (text: string, signal?: AbortSignal) => AsyncIterable<AgentEvent>;
  abort: () => Promise<void>;
  dispose: () => void;
}

export interface PiSessionFactoryInput {
  threadId: string;
  cwd: string;
  /** Eco-owned dir for PI auth/models isolation (not ~/.pi). */
  agentDir: string;
  model: EcoPiModelSpec;
  /** Local bridge API key (Eco LOCAL_PROXY_API_KEY). */
  apiKey: string;
  sessionId?: string;
}

export type PiSessionFactory = (input: PiSessionFactoryInput) => Promise<PiSessionHandle>;

export interface PiCodingAgentDriverOptions {
  /** Override for tests; production resolves `@earendil-works/pi-coding-agent`. */
  createSession?: PiSessionFactory;
  /**
   * Resolve bridge credentials + model alias from routes.
   * Desktop injects bridge baseUrl / key / alias after starting Anthropic proxy routes.
   */
  resolveBridgeModel: (input: {
    threadId: string;
    routes: readonly ResolvedModelRoute[];
  }) => Promise<{
    bridgeBaseUrl: string;
    bridgeModelId: string;
    apiKey: string;
    agentDir: string;
    contextWindow?: number;
    maxOutputTokens?: number;
  }>;
}

/**
 * Process-scoped PI sessions keyed by Eco threadId for multi-session concurrency.
 */
export class PiSessionRegistry {
  private readonly sessions = new Map<string, PiSessionHandle>();

  get(threadId: string): PiSessionHandle | undefined {
    return this.sessions.get(threadId);
  }

  set(threadId: string, session: PiSessionHandle): void {
    this.sessions.set(threadId, session);
  }

  delete(threadId: string): void {
    const existing = this.sessions.get(threadId);
    if (existing) {
      try {
        existing.dispose();
      } catch {
        // ignore dispose errors during teardown
      }
      this.sessions.delete(threadId);
    }
  }

  async abort(threadId: string): Promise<void> {
    const existing = this.sessions.get(threadId);
    if (!existing) {
      return;
    }
    await existing.abort();
  }
}

export const globalPiSessionRegistry = new PiSessionRegistry();

export class PiCodingAgentDriver implements AgentRuntimeDriver {
  private readonly createSession: PiSessionFactory;
  private readonly resolveBridgeModel: PiCodingAgentDriverOptions["resolveBridgeModel"];
  private readonly registry: PiSessionRegistry;

  constructor(
    options: PiCodingAgentDriverOptions,
    registry: PiSessionRegistry = globalPiSessionRegistry,
  ) {
    this.createSession = options.createSession ?? createDefaultPiSession;
    this.resolveBridgeModel = options.resolveBridgeModel;
    this.registry = registry;
  }

  async *run(input: AgentRuntimeRunInput): AsyncIterable<AgentEvent> {
    const cwd = input.worktreePath?.trim() || input.workspacePath;
    const planner = resolvePiPlannerRoute(input.routes);
    if (!planner) {
      yield createAgentEvent({
        id: `${input.threadId}:pi:no-route`,
        threadId: input.threadId,
        agentId: "system",
        role: "planner",
        type: "thread.failed",
        payload: { message: "PI Core 需要至少一条可用模型路由。" },
      });
      return;
    }

    const bridge = await this.resolveBridgeModel({
      threadId: input.threadId,
      routes: input.routes,
    });
    const modelSpec = buildEcoPiModel({
      bridgeBaseUrl: bridge.bridgeBaseUrl,
      bridgeModelId: bridge.bridgeModelId,
      route: planner,
      ...(bridge.contextWindow !== undefined && { contextWindow: bridge.contextWindow }),
      ...(bridge.maxOutputTokens !== undefined && { maxOutputTokens: bridge.maxOutputTokens }),
    } satisfies BuildEcoPiModelInput);

    let session = this.registry.get(input.threadId);
    if (!session || session.cwd !== cwd) {
      this.registry.delete(input.threadId);
      session = await this.createSession({
        threadId: input.threadId,
        cwd,
        agentDir: bridge.agentDir,
        model: modelSpec,
        apiKey: bridge.apiKey,
      });
      this.registry.set(input.threadId, session);
    }

    yield createAgentEvent({
      id: `${input.threadId}:pi:session.captured`,
      threadId: input.threadId,
      agentId: session.sessionId,
      role: "planner",
      type: "session.captured",
      payload: {
        sessionId: session.sessionId,
        cwd,
      },
    });

    const onAbort = () => {
      void session?.abort();
    };
    if (input.signal.aborted) {
      await session.abort();
      return;
    }
    input.signal.addEventListener("abort", onAbort, { once: true });
    try {
      yield* session.prompt(input.prompt, input.signal);
    } finally {
      input.signal.removeEventListener("abort", onAbort);
    }
  }
}

async function createDefaultPiSession(input: PiSessionFactoryInput): Promise<PiSessionHandle> {
  const pi = await import("@earendil-works/pi-coding-agent");
  const {
    createAgentSession,
    createExtensionRuntime,
    ModelRuntime,
    SessionManager,
    SettingsManager,
  } = pi;

  const modelRuntime = await ModelRuntime.create({
    authPath: `${input.agentDir}/auth.json`,
    modelsPath: `${input.agentDir}/models.json`,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  await modelRuntime.setRuntimeApiKey("anthropic", input.apiKey);

  const resourceLoader = {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () =>
      "You are PI running inside Eco Coding. Use read/write/edit/bash tools to fulfill the user's request. Be concise.",
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
  });
  const sessionManager = SessionManager.inMemory(input.cwd, {
    ...(input.sessionId ? { id: input.sessionId } : {}),
  });

  const { session } = await createAgentSession({
    cwd: input.cwd,
    agentDir: input.agentDir,
    model: input.model as never,
    thinkingLevel: "off",
    modelRuntime,
    resourceLoader: resourceLoader as never,
    tools: ["read", "bash", "edit", "write"],
    sessionManager,
    settingsManager,
  });

  const sessionId = sessionManager.getSessionId();
  let seq = 0;
  const adapterState = createPiEventAdapterState();

  return {
    sessionId,
    cwd: input.cwd,
    abort: async () => {
      await session.abort();
    },
    dispose: () => {
      session.dispose();
    },
    async *prompt(text: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
      const queue: AgentEvent[] = [];
      let resolveWait: (() => void) | undefined;
      let done = false;
      let runError: unknown;

      const wake = () => {
        resolveWait?.();
        resolveWait = undefined;
      };

      const unsubscribe = session.subscribe((event) => {
        const mapped = mapPiSessionEventToAgentEvents(event as PiSessionEventLike, {
          threadId: input.threadId,
          sessionId,
          state: adapterState,
          nextSeq: () => {
            seq += 1;
            return seq;
          },
        });
        if (mapped.length > 0) {
          queue.push(...mapped);
          wake();
        }
      });

      const promptPromise = session
        .prompt(text, signal?.aborted ? { source: "rpc" } : { source: "rpc" })
        .then(() => {
          done = true;
          wake();
        })
        .catch((error: unknown) => {
          runError = error;
          done = true;
          wake();
        });

      try {
        while (!done || queue.length > 0) {
          if (signal?.aborted) {
            await session.abort();
            break;
          }
          if (queue.length === 0) {
            await new Promise<void>((resolve) => {
              resolveWait = resolve;
            });
            continue;
          }
          const next = queue.shift();
          if (next) {
            yield next;
          }
        }
        await promptPromise;
        if (runError) {
          const message = runError instanceof Error ? runError.message : String(runError);
          yield createAgentEvent({
            id: `${input.threadId}:pi:error:${seq + 1}`,
            threadId: input.threadId,
            agentId: sessionId,
            role: "planner",
            type: "thread.failed",
            payload: { message },
          });
        }
      } finally {
        unsubscribe();
      }
    },
  };
}
