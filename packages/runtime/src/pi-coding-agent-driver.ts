import type { ResolvedModelRoute } from "../../model-router/src";
import { type AgentEvent, createAgentEvent } from "../../shared/src";
import type { AgentRuntimeDriver, AgentRuntimeRunInput } from "./index.js";
import { mapPiSessionEventToAgentEvents, type PiSessionEventLike, createPiEventAdapterState } from "./pi-event-adapter.js";
import {
  type BuildEcoPiModelInput,
  type EcoApiCompat,
  type EcoPiModelSpec,
  buildEcoPiModel,
  computePiRouteFingerprint,
  mapApiCompatToPiAuthProvider,
  resolvePiPlannerRoute,
} from "./pi-model-bridge.js";

export interface PiSessionHandle {
  sessionId: string;
  cwd: string;
  /** Session-identity fingerprint (excludes attempt bindingId). */
  routeFingerprint: string;
  /** Last armed binding id — must not reuse across attempts. */
  bindingId: string;
  prompt: (text: string, signal?: AbortSignal) => AsyncIterable<AgentEvent>;
  abort: () => Promise<void>;
  dispose: () => void;
  /** Rebind model + attempt credential without disposing conversation state. */
  rebind: (input: PiSessionRebindInput) => Promise<void>;
}

export interface PiSessionRebindInput {
  model: EcoPiModelSpec;
  apiKey: string;
  apiCompat: EcoApiCompat;
  bindingId: string;
  routeFingerprint: string;
}

export interface PiSessionFactoryInput {
  threadId: string;
  cwd: string;
  /** Eco-owned dir for PI auth/models isolation (not ~/.pi). */
  agentDir: string;
  model: EcoPiModelSpec;
  /** Attempt-scoped bridge credential (Eco Gateway binding). */
  apiKey: string;
  apiCompat: EcoApiCompat;
  bindingId: string;
  routeFingerprint: string;
  sessionId?: string;
}

export type PiSessionFactory = (input: PiSessionFactoryInput) => Promise<PiSessionHandle>;

export interface PiBridgeModelResolution {
  bridgeBaseUrl: string;
  bridgeModelId: string;
  apiKey: string;
  agentDir: string;
  apiCompat: EcoApiCompat;
  bindingId: string;
  providerId: string;
  headers?: Record<string, string>;
  contextWindow?: number;
  maxOutputTokens?: number;
  runAttemptId?: string;
}

export interface PiCodingAgentDriverOptions {
  /** Override for tests; production resolves `@earendil-works/pi-coding-agent`. */
  createSession?: PiSessionFactory;
  /**
   * Resolve attempt-scoped Gateway binding credentials + model alias from routes.
   * Desktop injects Bridge baseUrl / key / alias after starting Gateway route binding.
   */
  resolveBridgeModel: (input: {
    threadId: string;
    routes: readonly ResolvedModelRoute[];
  }) => Promise<PiBridgeModelResolution>;
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
    }
    this.sessions.delete(threadId);
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
    const apiCompat = bridge.apiCompat;
    const modelSpec = buildEcoPiModel({
      bridgeBaseUrl: bridge.bridgeBaseUrl,
      bridgeModelId: bridge.bridgeModelId,
      route: planner,
      apiCompat,
      ...(bridge.contextWindow !== undefined && { contextWindow: bridge.contextWindow }),
      ...(bridge.maxOutputTokens !== undefined && { maxOutputTokens: bridge.maxOutputTokens }),
      ...(bridge.headers && { headers: bridge.headers }),
    } satisfies BuildEcoPiModelInput);

    const fullFingerprint = computePiRouteFingerprint({
      cwd,
      providerId: bridge.providerId,
      modelId: bridge.bridgeModelId,
      apiCompat,
      baseUrl: bridge.bridgeBaseUrl,
      bindingId: bridge.bindingId,
      routes: input.routes,
    });
    const sessionIdentityFingerprint = computePiSessionIdentityFingerprint({
      cwd,
      providerId: bridge.providerId,
      modelId: bridge.bridgeModelId,
      apiCompat,
      baseUrl: bridge.bridgeBaseUrl,
      routes: input.routes,
    });

    let session = this.registry.get(input.threadId);
    const identityChanged =
      !session ||
      session.cwd !== cwd ||
      stripBindingFromFingerprint(session.routeFingerprint) !== sessionIdentityFingerprint;

    if (identityChanged || !session) {
      this.registry.delete(input.threadId);
      session = await this.createSession({
        threadId: input.threadId,
        cwd,
        agentDir: bridge.agentDir,
        model: modelSpec,
        apiKey: bridge.apiKey,
        apiCompat,
        bindingId: bridge.bindingId,
        routeFingerprint: fullFingerprint,
      });
      this.registry.set(input.threadId, session);
    } else if (session.bindingId !== bridge.bindingId) {
      // Same session identity — rebind attempt credential; never reuse old attempt key.
      await session.rebind({
        model: modelSpec,
        apiKey: bridge.apiKey,
        apiCompat,
        bindingId: bridge.bindingId,
        routeFingerprint: fullFingerprint,
      });
    }

    const activeSession = session;

    yield createAgentEvent({
      id: `${input.threadId}:pi:session.captured`,
      threadId: input.threadId,
      agentId: activeSession.sessionId,
      role: "planner",
      type: "session.captured",
      payload: {
        sessionId: activeSession.sessionId,
        cwd,
        bindingId: bridge.bindingId,
        apiCompat,
        routeFingerprint: fullFingerprint,
      },
    });

    const onAbort = () => {
      void activeSession.abort();
    };
    if (input.signal.aborted) {
      await activeSession.abort();
      return;
    }
    input.signal.addEventListener("abort", onAbort, { once: true });
    try {
      yield* activeSession.prompt(input.prompt, input.signal);
    } finally {
      input.signal.removeEventListener("abort", onAbort);
    }
  }
}

/** Session identity omits bindingId so conversation can survive attempt rebind. */
export function computePiSessionIdentityFingerprint(input: {
  cwd: string;
  providerId: string;
  modelId: string;
  apiCompat: EcoApiCompat;
  baseUrl: string;
  routes: readonly ResolvedModelRoute[];
}): string {
  return computePiRouteFingerprint({
    ...input,
    bindingId: "",
  }).replace(/;binding=;/, ";binding=;");
}

function stripBindingFromFingerprint(fingerprint: string): string {
  return fingerprint.replace(/;binding=[^;]*/, ";binding=");
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
  const authProvider = mapApiCompatToPiAuthProvider(input.apiCompat);
  await modelRuntime.setRuntimeApiKey(authProvider, input.apiKey);

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

  // ECO owns compaction; disable PI compaction. Provider retry 0 avoids Gateway double-retry.
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: {
      enabled: false,
      maxRetries: 0,
      provider: { maxRetries: 0 },
    },
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
  let routeFingerprint = input.routeFingerprint;
  let bindingId = input.bindingId;
  let apiCompat = input.apiCompat;

  return {
    sessionId,
    cwd: input.cwd,
    get routeFingerprint() {
      return routeFingerprint;
    },
    get bindingId() {
      return bindingId;
    },
    abort: async () => {
      await session.abort();
    },
    dispose: () => {
      session.dispose();
    },
    rebind: async (rebindInput) => {
      const nextAuthProvider = mapApiCompatToPiAuthProvider(rebindInput.apiCompat);
      await modelRuntime.setRuntimeApiKey(nextAuthProvider, rebindInput.apiKey);
      // AgentSession.setModel is the supported rebind path (keeps conversation state).
      await (session as { setModel: (model: unknown) => Promise<void> }).setModel(rebindInput.model);
      bindingId = rebindInput.bindingId;
      routeFingerprint = rebindInput.routeFingerprint;
      apiCompat = rebindInput.apiCompat;
      void apiCompat;
    },
    async *prompt(text: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
      const queue: AgentEvent[] = [];
      let resolveWait: (() => void) | undefined;
      let done = false;
      let runError: unknown;
      let sawSettled = false;

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
        if ((event as { type?: string }).type === "agent_settled") {
          sawSettled = true;
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
        // Only real agent_settled may complete. prompt promise done alone is not settle.
        const terminal = decidePiPromptRunTerminal({
          sawAgentSettled: sawSettled,
          aborted: Boolean(signal?.aborted),
          ...(runError
            ? {
                errorMessage:
                  runError instanceof Error ? runError.message : String(runError),
              }
            : {}),
          promptReturned: done && !runError && !signal?.aborted,
        });
        if (terminal) {
          yield createAgentEvent({
            id: `${input.threadId}:pi:terminal:${terminal.status}:${seq + 1}`,
            threadId: input.threadId,
            agentId: sessionId,
            role: "planner",
            type: "run.terminal",
            payload: terminal,
          });
        }
      } finally {
        unsubscribe();
      }
    },
  };
}

/**
 * Decide upward run.terminal after a PI prompt attempt.
 * `promptReturned` (promise done) is NOT settle — only `sawAgentSettled` may complete.
 */
export function decidePiPromptRunTerminal(input: {
  sawAgentSettled: boolean;
  aborted: boolean;
  errorMessage?: string;
  /** Prompt promise fulfilled without throw/abort — still not a settle signal. */
  promptReturned: boolean;
}):
  | { status: "completed" }
  | { status: "failed"; error: string }
  | { status: "cancelled"; reason: string }
  | { status: "incomplete"; reason: string }
  | undefined {
  if (input.aborted) {
    return { status: "cancelled", reason: "cancelled by user" };
  }
  if (input.errorMessage) {
    return { status: "failed", error: input.errorMessage };
  }
  if (input.sawAgentSettled) {
    return { status: "completed" };
  }
  if (input.promptReturned) {
    return {
      status: "incomplete",
      reason: "PI prompt returned without agent_settled.",
    };
  }
  return undefined;
}
