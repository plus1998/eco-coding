import type { ResolvedModelRoute } from "../../model-router/src";
import { type AgentEvent, createAgentEvent } from "../../shared/src";
import type { AgentRuntimeDriver, AgentRuntimeRunInput } from "./index.js";
import { createEcoPiAgentExtensionFactory } from "./pi-eco-extensions.js";
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
import {
  canonicalizePiMcpFingerprint,
  createPiMcpExtensionFactory,
  fingerprintPiMcpServers,
  piMcpToolAllowlist,
  toPiMcpAdapterConfig,
} from "./pi-mcp.js";
import {
  clearPiSessionFiles,
  ensurePiSessionsDir,
  isUsablePiSessionFile,
} from "./pi-session-paths.js";
import {
  ensurePiPrivateSkillsDir,
  fingerprintPiSkillPaths,
  resolvePiSessionSkillPaths,
} from "./pi-skills.js";
import {
  listEnabledPiSubagents,
  PI_AGENT_TOOL_NAME,
  piParentSessionKey,
} from "./pi-subagent.js";

export interface PiSideEventBus {
  push(event: AgentEvent): void;
  subscribe(listener: (event: AgentEvent) => void): () => void;
}

export function createPiSideEventBus(): PiSideEventBus {
  const listeners = new Set<(event: AgentEvent) => void>();
  return {
    push(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface PiSessionHandle {
  sessionId: string;
  /** Absolute JSONL path when persisting; undefined only for test doubles. */
  sessionFile?: string;
  cwd: string;
  /** Session-identity fingerprint (excludes attempt bindingId). */
  routeFingerprint: string;
  /** Last armed binding id — must not reuse across attempts. */
  bindingId: string;
  /** Fingerprint of Eco-selected skill paths (excludes private agentDir/skills). */
  skillsFingerprint: string;
  /** Fingerprint of Eco-selected MCP servers for this session. */
  mcpFingerprint: string;
  prompt: (text: string, signal?: AbortSignal) => AsyncIterable<AgentEvent>;
  abort: () => Promise<void>;
  dispose: () => void;
  /** Rebind model + attempt credential without disposing conversation state. */
  rebind: (input: PiSessionRebindInput) => Promise<void>;
  /**
   * Hot-update skill visibility without disposing conversation state.
   * Always re-includes `<agentDir>/skills` for session-private mounts.
   */
  updateSkillPaths: (skillPaths: readonly string[]) => Promise<void>;
  /** Parent-only: re-arm spawn handler for this run (session reuse). */
  armSubagentSpawn?: (handler: import("./pi-subagent.js").PiSubagentSpawnHandler | undefined) => void;
  /** Parent-only side bus created with the session (stable across rebinds). */
  sideEventBus?: PiSideEventBus;
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
  /** Eco-owned dir for PI auth/models/skills isolation (not ~/.pi). */
  agentDir: string;
  model: EcoPiModelSpec;
  /** Attempt-scoped bridge credential (Eco Gateway binding). */
  apiKey: string;
  apiCompat: EcoApiCompat;
  bindingId: string;
  routeFingerprint: string;
  /** Eco-selected skill directories or SKILL.md paths for this thread. */
  skillPaths?: readonly string[];
  /** Isolated MCP servers for this thread (Claude-SDK shaped). */
  mcpServers?: Record<string, unknown>;
  /** Extra system prompt append segments for integrations. */
  appendSystemPrompt?: readonly string[];
  sessionId?: string;
  /** Resume from this Eco-owned JSONL when present and readable. */
  sessionFile?: string;
  /** When true, delete existing `sessions/*.jsonl` before create (identity/MCP drift). */
  replacePersistedSessions?: boolean;
  /** Override default Eco PI system prompt (used by subagents). */
  systemPromptOverride?: string;
  /** Explicit tool allowlist; defaults to builtins (+ mcp proxies when MCP present). */
  toolsAllowlist?: readonly string[];
  /** Extra Eco extension factories (Agent tool, tests). */
  extensionFactories?: readonly {
    name: string;
    factory: (pi: unknown) => void | Promise<void>;
  }[];
  /** Parent sessions drain this bus so child events stream during Agent tool waits. */
  sideEventBus?: PiSideEventBus;
  /** Eco feed role (parent planner / subagent agentKey). */
  eventRole?: string;
  /** Eco feed agentId override (subagent instance id). */
  eventAgentId?: string;
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
  globalContextWindowLimit?: number;
}

export interface PiCodingAgentDriverOptions {
  /** Override for tests; production resolves `@earendil-works/pi-coding-agent`. */
  createSession?: PiSessionFactory;
  /**
   * Resolve attempt-scoped Gateway binding credentials + model alias from routes.
   * Desktop injects Bridge baseUrl / key / alias after starting Gateway route binding.
   * Pass `role` for subagent routes; omit for planner.
   */
  resolveBridgeModel: (input: {
    threadId: string;
    routes: readonly ResolvedModelRoute[];
    role?: string;
  }) => Promise<PiBridgeModelResolution>;
}

/**
 * Process-scoped PI sessions. Parent key = threadId; child key = threadId::sub::agentId.
 */
export class PiSessionRegistry {
  private readonly sessions = new Map<string, PiSessionHandle>();

  get(key: string): PiSessionHandle | undefined {
    return this.sessions.get(key);
  }

  set(key: string, session: PiSessionHandle): void {
    this.sessions.set(key, session);
  }

  /** Delete one session key (parent or child). */
  delete(key: string): void {
    const existing = this.sessions.get(key);
    if (existing) {
      try {
        existing.dispose();
      } catch {
        // ignore dispose errors during teardown
      }
    }
    this.sessions.delete(key);
  }

  /** Delete parent + every child session for an Eco thread. */
  deleteThread(threadId: string): void {
    for (const key of this.keysForThread(threadId)) {
      this.delete(key);
    }
  }

  async abort(threadId: string): Promise<void> {
    await Promise.all(
      this.keysForThread(threadId).map(async (key) => {
        const existing = this.sessions.get(key);
        if (!existing) {
          return;
        }
        await existing.abort();
      }),
    );
  }

  private keysForThread(threadId: string): string[] {
    const parent = piParentSessionKey(threadId);
    return [...this.sessions.keys()].filter(
      (key) => key === parent || key.startsWith(`${parent}::sub::`),
    );
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
      ...(bridge.globalContextWindowLimit !== undefined && {
        globalContextWindowLimit: bridge.globalContextWindowLimit,
      }),
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

    let session = this.registry.get(piParentSessionKey(input.threadId));
    const hadRegistrySession = Boolean(session);
    const identityDrift =
      Boolean(session) &&
      (session!.cwd !== cwd ||
        stripBindingFromFingerprint(session!.routeFingerprint) !== sessionIdentityFingerprint);
    const selectedSkillPaths = input.piSession?.skillPaths ?? [];
    const skillsFingerprint = fingerprintPiSkillPaths(selectedSkillPaths);
    const mcpServers = input.piSession?.mcpServers;
    const mcpFingerprint = fingerprintPiMcpServers(mcpServers);
    const mcpDrift = Boolean(session) && session!.mcpFingerprint !== mcpFingerprint;
    const wantsAgentTool = listEnabledPiSubagents(input.agentRegistry).length > 0;
    const agentToolDrift = Boolean(session) && wantsAgentTool !== Boolean(session!.armSubagentSpawn);
    const forceFresh = identityDrift || mcpDrift || agentToolDrift;
    const appendSystemPrompt = [...(input.piSession?.appendSystemPrompt ?? [])].filter(
      (entry) => entry.trim().length > 0,
    );

    const resumeFile = input.piSession?.sessionFile?.trim();
    const diskResumeOk =
      !hadRegistrySession &&
      !forceFresh &&
      Boolean(resumeFile) &&
      input.piSession?.resumeIdentityFingerprint === sessionIdentityFingerprint &&
      canonicalizePiMcpFingerprint(input.piSession?.resumeMcpFingerprint ?? "") ===
        mcpFingerprint;

    const spawnBridge: {
      handler: import("./pi-subagent.js").PiSubagentSpawnHandler | undefined;
    } = {
      handler: input.piSession?.onSubagentSpawn,
    };
    const enabledSubagents = listEnabledPiSubagents(input.agentRegistry);
    const extensionFactories: Array<{
      name: string;
      factory: (pi: unknown) => void | Promise<void>;
    }> = [];

    // MCP is extension-loaded at session create; fingerprint drift requires a new session.
    // Cold start with matching fingerprints may open the Eco-owned JSONL instead.
    if (!session || forceFresh) {
      const sideEventBus = createPiSideEventBus();
      if (input.agentRegistry && enabledSubagents.length > 0) {
        extensionFactories.push({
          name: "eco-pi-agent",
          factory: createEcoPiAgentExtensionFactory({
            threadId: input.threadId,
            registry: input.agentRegistry,
            emitSideEvent: (event) => sideEventBus.push(event),
            onSubagentSpawn: async (spawnInput) => {
              const handler = spawnBridge.handler;
              if (!handler) {
                throw new Error("PI subagent spawn handler is not armed for this run.");
              }
              return handler(spawnInput);
            },
          }) as (pi: unknown) => void,
        });
      }
      this.registry.deleteThread(input.threadId);
      session = await this.createSession({
        threadId: input.threadId,
        cwd,
        agentDir: bridge.agentDir,
        model: modelSpec,
        apiKey: bridge.apiKey,
        apiCompat,
        bindingId: bridge.bindingId,
        routeFingerprint: fullFingerprint,
        skillPaths: selectedSkillPaths,
        ...(mcpServers && Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
        ...(appendSystemPrompt.length > 0 ? { appendSystemPrompt } : {}),
        ...(diskResumeOk && resumeFile ? { sessionFile: resumeFile } : {}),
        ...(forceFresh || (!diskResumeOk && Boolean(resumeFile))
          ? { replacePersistedSessions: true }
          : {}),
        sideEventBus,
        ...(extensionFactories.length > 0 ? { extensionFactories } : {}),
      });
      if (extensionFactories.length > 0) {
        session.armSubagentSpawn = (handler) => {
          spawnBridge.handler = handler;
        };
        session.sideEventBus = sideEventBus;
      }
      this.registry.set(piParentSessionKey(input.threadId), session);
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

    session.armSubagentSpawn?.(input.piSession?.onSubagentSpawn);

    if (session.skillsFingerprint !== skillsFingerprint) {
      await session.updateSkillPaths(selectedSkillPaths);
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
        identityFingerprint: sessionIdentityFingerprint,
        mcpFingerprint,
        ...(activeSession.sessionFile ? { sessionFile: activeSession.sessionFile } : {}),
      },
    });

    const onAbort = () => {
      void activeSession.abort();
      void this.registry.abort(input.threadId);
    };
    if (input.signal.aborted) {
      await activeSession.abort();
      await this.registry.abort(input.threadId);
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
    DefaultResourceLoader,
    loadSkills,
    ModelRuntime,
    SessionManager,
    SettingsManager,
  } = pi;

  await ensurePiPrivateSkillsDir(input.agentDir);

  const modelRuntime = await ModelRuntime.create({
    authPath: `${input.agentDir}/auth.json`,
    modelsPath: `${input.agentDir}/models.json`,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const authProvider = mapApiCompatToPiAuthProvider(input.apiCompat);
  await modelRuntime.setRuntimeApiKey(authProvider, input.apiKey);

  let selectedSkillPaths = [...(input.skillPaths ?? [])];
  let skillsFingerprint = fingerprintPiSkillPaths(selectedSkillPaths);
  let skillsState = loadSkills({
    cwd: input.cwd,
    agentDir: input.agentDir,
    skillPaths: resolvePiSessionSkillPaths({
      agentDir: input.agentDir,
      skillPaths: selectedSkillPaths,
    }),
    includeDefaults: false,
  });

  const mcpFingerprint = fingerprintPiMcpServers(input.mcpServers);
  const mappedMcp = toPiMcpAdapterConfig(input.mcpServers);
  const hasMcpServers = Object.keys(mappedMcp.mcpServers).length > 0;
  const mcpFactory = await createPiMcpExtensionFactory(
    hasMcpServers ? input.mcpServers : undefined,
    { agentDir: input.agentDir },
  );

  const appendSystemPrompt = [...(input.appendSystemPrompt ?? [])]
    .map((entry) => entry.trim())
    .filter(Boolean);

  // PI owns native compaction. Provider retry 0 avoids Gateway double-retry.
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: {
      enabled: false,
      maxRetries: 0,
      provider: { maxRetries: 0 },
    },
  });

  const systemPromptText =
    input.systemPromptOverride?.trim() ||
    "You are PI running inside Eco Coding. Use read/write/edit/bash tools to fulfill the user's request. Be concise.";

  const extensionFactories: Array<{ name: string; factory: (pi: unknown) => void | Promise<void> }> =
    [];
  if (mcpFactory) {
    extensionFactories.push({
      name: "eco-pi-mcp",
      factory: mcpFactory as never,
    });
  }
  for (const entry of input.extensionFactories ?? []) {
    extensionFactories.push(entry);
  }

  const resourceLoader = new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: input.agentDir,
    settingsManager,
    // Block ambient package/file extensions; only Eco-injected factories.
    noExtensions: true,
    ...(extensionFactories.length > 0
      ? {
          extensionFactories: extensionFactories.map((entry) => ({
            name: entry.name,
            factory: entry.factory as never,
          })),
        }
      : {}),
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    skillsOverride: () => skillsState,
    systemPromptOverride: () => systemPromptText,
    appendSystemPromptOverride: () => appendSystemPrompt,
  });
  await resourceLoader.reload();

  const sessionsDir = await ensurePiSessionsDir(input.agentDir);
  if (input.replacePersistedSessions) {
    await clearPiSessionFiles(input.agentDir);
  }

  let sessionManager;
  const resumePath = input.sessionFile?.trim();
  if (
    resumePath &&
    !input.replacePersistedSessions &&
    (await isUsablePiSessionFile(resumePath, sessionsDir))
  ) {
    sessionManager = SessionManager.open(resumePath, sessionsDir, input.cwd);
  } else {
    sessionManager = SessionManager.create(input.cwd, sessionsDir, {
      ...(input.sessionId ? { id: input.sessionId } : {}),
    });
  }

  const toolsAllowlistBase =
    input.toolsAllowlist && input.toolsAllowlist.length > 0
      ? [...input.toolsAllowlist]
      : piMcpToolAllowlist(hasMcpServers);
  // PI's `tools` option is an allowlist: extension tools not listed here are dropped
  // from the registry (see AgentSession._refreshToolRegistry). Agent must be included
  // whenever eco-pi-agent is loaded, or the model only sees mcp/browser and never Agent.
  const hasAgentExtension = (input.extensionFactories ?? []).some(
    (entry) => entry.name === "eco-pi-agent",
  );
  const toolsAllowlist =
    hasAgentExtension && !toolsAllowlistBase.includes(PI_AGENT_TOOL_NAME)
      ? [...toolsAllowlistBase, PI_AGENT_TOOL_NAME]
      : toolsAllowlistBase;

  const { session } = await createAgentSession({
    cwd: input.cwd,
    agentDir: input.agentDir,
    model: input.model as never,
    thinkingLevel: "off",
    modelRuntime,
    resourceLoader: resourceLoader as never,
    tools: toolsAllowlist,
    sessionManager,
    settingsManager,
  });

  // PI CLI modes call bindExtensions (emits session_start → MCP init). Eco creates
  // sessions headlessly and must do the same; otherwise mcp() stays "MCP not initialized".
  if (typeof session.bindExtensions === "function") {
    await session.bindExtensions({
      mode: "rpc",
      onError: (err: { extensionPath?: string; error?: string }) => {
        console.error(
          `PI extension error (${err.extensionPath ?? "?"}): ${err.error ?? "unknown"}`,
        );
      },
    });
  }

  const sessionId = sessionManager.getSessionId();
  const sessionFile = sessionManager.getSessionFile() ?? undefined;
  let seq = 0;
  const adapterState = createPiEventAdapterState();
  let routeFingerprint = input.routeFingerprint;
  let bindingId = input.bindingId;
  let apiCompat = input.apiCompat;
  const eventRole = input.eventRole?.trim() || "planner";
  const eventAgentId = input.eventAgentId?.trim() || sessionId;
  const sideEventBus = input.sideEventBus;

  return {
    sessionId,
    ...(sessionFile ? { sessionFile } : {}),
    cwd: input.cwd,
    get routeFingerprint() {
      return routeFingerprint;
    },
    get bindingId() {
      return bindingId;
    },
    get skillsFingerprint() {
      return skillsFingerprint;
    },
    get mcpFingerprint() {
      return mcpFingerprint;
    },
    ...(sideEventBus ? { sideEventBus } : {}),
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
    updateSkillPaths: async (skillPaths) => {
      selectedSkillPaths = [...skillPaths];
      skillsFingerprint = fingerprintPiSkillPaths(selectedSkillPaths);
      await ensurePiPrivateSkillsDir(input.agentDir);
      skillsState = loadSkills({
        cwd: input.cwd,
        agentDir: input.agentDir,
        skillPaths: resolvePiSessionSkillPaths({
          agentDir: input.agentDir,
          skillPaths: selectedSkillPaths,
        }),
        includeDefaults: false,
      });
      // AgentSession.reload re-reads ResourceLoader and rebuilds the system prompt.
      await (
        session as { reload: (options?: Record<string, never>) => Promise<void> }
      ).reload();
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

      const mapCtx = {
        threadId: input.threadId,
        sessionId,
        agentId: eventAgentId,
        role: eventRole,
        state: adapterState,
        nextSeq: () => {
          seq += 1;
          return seq;
        },
      };

      const unsubscribe = session.subscribe((event) => {
        const mapped = mapPiSessionEventToAgentEvents(event as PiSessionEventLike, mapCtx);
        if (mapped.length > 0) {
          queue.push(...mapped);
          wake();
        }
        if ((event as { type?: string }).type === "agent_settled") {
          sawSettled = true;
        }
      });

      const unsubscribeSide = sideEventBus?.subscribe((event) => {
        queue.push(event);
        wake();
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
            agentId: eventAgentId,
            role: eventRole,
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
            agentId: eventAgentId,
            role: eventRole,
            type: "run.terminal",
            payload: terminal,
          });
        }
      } finally {
        unsubscribe();
        unsubscribeSide?.();
      }
    },
  };
}

/** Exported for desktop subagent host / tests. */
export { createDefaultPiSession };

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
