import path from "node:path";
import type { WorktreePlan } from "@eco/workspace";
import type { ResolvedModelRoute } from "@eco/model-router";
import {
  type AgentEvent,
  type CoreKind,
  type EcoApiCompat,
  PiCodingAgentDriver,
  globalPiSessionRegistry,
  probePiCoreAvailability,
  removePiAgentThreadDir,
  resolvePiAgentDir,
  resolvePiPlannerRoute,
} from "@eco/runtime";
import type { PromptImageAttachment, ThreadSummary, WorkspaceInfo } from "../shared/ipc";
import type { ActiveRunRuntimeStateInput } from "./active-run-runtime-state";
import type { RuntimeRoute } from "./billing-resolver";
import {
  type StartedGatewayRouteBinding,
  buildPiGatewayRequestHeaders,
} from "./gateway-route-binding";
import type { RequestAttemptResult } from "./request-retry";
import { buildDriverRoutes } from "./thread-runtime-routes";
import type { RunAttemptContext } from "./thread-run-attempt";
import { resolveUpstreamApiCompat } from "../shared/api-compat";

export interface PiThreadStartRunInput {
  thread: ThreadSummary;
  workspace: WorkspaceInfo;
  runtimeConfig: { routes: RuntimeRoute[] };
  prompt: string;
  attachments?: PromptImageAttachment[];
  roleRoutes?: unknown;
  continuation?: boolean;
  /** Absolute skill directories enabled for this PI thread (Eco visibility isolation). */
  skillPaths?: string[];
  /** Isolated MCP servers for this PI thread (Claude-SDK shaped entries). */
  mcpServers?: Record<string, unknown>;
  /** Extra system prompt append (browser / image integration guidance). */
  appendSystemPrompt?: string[];
}

export interface PiRuntimeOrchestrationDeps {
  ecoDataDir: string;
  requireThreadCore: (
    thread: Pick<ThreadSummary, "id" | "coreKind">,
    expected: CoreKind,
    op: string,
  ) => void;
  resolveSessionMode: (runtimeConfig: ThreadSummary["runtimeConfig"]) => "agent" | "plan" | "ask";
  startActiveRun: (threadId: string, run: ActiveRunRuntimeStateInput) => void;
  createSessionPlan: (workspacePath: string, threadId: string) => WorktreePlan;
  resolveThreadWorktree: (
    workspace: WorkspaceInfo,
    threadId: string,
  ) => Promise<{ worktreePlan: WorktreePlan; cwd: string }>;
  runThreadRequestOnce: (
    threadId: string,
    phase: "execution" | "ask" | "planning" | "continuation",
    signal: AbortSignal,
    run: (context: RunAttemptContext) => Promise<RequestAttemptResult>,
  ) => Promise<RequestAttemptResult>;
  resolveRuntimeConfigForThreadId: (threadId: string) =>
    | { ok: true; routes: RuntimeRoute[]; reason?: undefined }
    | { ok: false; routes?: undefined; reason: string }
    | { ok: true; routes: RuntimeRoute[] }
    | { ok: false; reason: string };
  recordRouteFingerprint: (threadId: string, routes: readonly RuntimeRoute[]) => void;
  /** Attempt-scoped Gateway binding (Claude-compatible control plane). */
  startRuntimeProxy: (
    routes: RuntimeRoute[],
    attachments: PromptImageAttachment[] | undefined,
    context: RunAttemptContext,
  ) => Promise<StartedGatewayRouteBinding>;
  consumeEvents: (input: {
    events: AsyncIterable<AgentEvent>;
    threadId: string;
    worktreePath: string;
    signal: AbortSignal;
  }) => Promise<RequestAttemptResult>;
  applyRunDecision: (input: {
    threadId: string;
    decision: RequestAttemptResult;
  }) => Promise<void> | Promise<boolean> | void;
  finalizeCleanup: (threadId: string) => Promise<void>;
  markInterrupted: (threadId: string, reason: string) => void;
  updateThread: (threadId: string, patch: Pick<ThreadSummary, "message" | "status">) => void;
  captureSession: (
    threadId: string,
    sessionId: string,
    cwd: string,
    metadata?: {
      sessionFile?: string;
      identityFingerprint?: string;
      mcpFingerprint?: string;
    },
  ) => void;
  /** Stored PI core-session binding for disk resume (cwd checked against live worktree). */
  getThreadCoreSession: (threadId: string) =>
    | {
        coreKind: string;
        externalSessionId: string;
        cwd: string;
        metadata?: Record<string, unknown>;
      }
    | undefined;
  errorMessage: (error: unknown) => string;
}

/** Shared driver resolveBridge uses the most recently armed Gateway binding per thread. */
const armedBindingByThread = new Map<
  string,
  {
    binding: StartedGatewayRouteBinding;
    driverRoutes: ResolvedModelRoute[];
    agentDir: string;
    runAttemptId?: string;
  }
>();

let sharedDriver: PiCodingAgentDriver | undefined;

export function getPiCodingAgentDriver(ecoDataDir: string): PiCodingAgentDriver {
  if (!sharedDriver) {
    sharedDriver = new PiCodingAgentDriver({
      resolveBridgeModel: async ({ threadId, routes }) => {
        const armed = armedBindingByThread.get(threadId);
        if (!armed) {
          throw new Error("PI Gateway binding is not armed for this thread.");
        }
        const planner =
          armed.binding.routes.find((route) => route.role === "planner") ??
          armed.binding.routes[0];
        if (!planner) {
          throw new Error("PI Gateway binding has no model routes.");
        }
        const plannerRoute = resolvePiPlannerRoute(routes);
        const apiCompat = resolveUpstreamApiCompat(
          planner.apiCompat,
          planner.provider.apiCompat,
        ) as EcoApiCompat;
        const headers = buildPiGatewayRequestHeaders({
          bindingId: armed.binding.bindingId,
          threadId,
          ...(armed.runAttemptId ? { runAttemptId: armed.runAttemptId } : {}),
          providerId: planner.provider.id,
          requestedModel: planner.aliasModelId,
          apiCompat,
        });
        return {
          bridgeBaseUrl: armed.binding.baseUrl,
          bridgeModelId: planner.aliasModelId,
          apiKey: armed.binding.apiKey,
          agentDir: armed.agentDir,
          apiCompat,
          bindingId: armed.binding.bindingId,
          providerId: planner.provider.id,
          headers,
          ...(plannerRoute?.primary.contextWindow !== undefined && {
            contextWindow: plannerRoute.primary.contextWindow,
          }),
          ...(armed.runAttemptId ? { runAttemptId: armed.runAttemptId } : {}),
        };
      },
    });
  }
  void ecoDataDir;
  return sharedDriver;
}

export async function startPiThreadRun(
  input: PiThreadStartRunInput,
  deps: PiRuntimeOrchestrationDeps,
): Promise<void> {
  deps.requireThreadCore(input.thread, "pi", input.continuation ? "continue with PI" : "start PI");
  const mode = deps.resolveSessionMode(input.thread.runtimeConfig);
  if (mode !== "agent") {
    throw new Error("PI Core v1 only supports Agent mode (no Plan / Ask).");
  }

  const availability = await probePiCoreAvailability();
  if (!availability.available) {
    throw new Error(availability.reason ?? "PI Core is unavailable.");
  }

  const controller = new AbortController();
  deps.startActiveRun(input.thread.id, {
    controller,
    worktreePlan: deps.createSessionPlan(input.workspace.path, input.thread.id),
  });

  let cwd = input.workspace.path;
  try {
    const resolved = await deps.resolveThreadWorktree(input.workspace, input.thread.id);
    cwd = resolved.cwd;
    deps.startActiveRun(input.thread.id, {
      controller,
      worktreePlan: resolved.worktreePlan,
    });

    const outcome = await deps.runThreadRequestOnce(
      input.thread.id,
      "execution",
      controller.signal,
      async (attemptContext) => {
        const config = deps.resolveRuntimeConfigForThreadId(input.thread.id);
        if (!config.ok) {
          return { ok: false, reason: config.reason };
        }
        deps.recordRouteFingerprint(input.thread.id, config.routes);
        const binding = await deps.startRuntimeProxy(
          config.routes,
          input.attachments,
          attemptContext,
        );
        const agentDir = resolvePiAgentDir(deps.ecoDataDir, input.thread.id);
        const driverRoutes = buildDriverRoutes(binding.routes);
        const diskResume = resolvePiDiskResume({
          binding: deps.getThreadCoreSession(input.thread.id),
          cwd,
        });
        armedBindingByThread.set(input.thread.id, {
          binding,
          driverRoutes,
          agentDir,
          ...(attemptContext.runAttemptId
            ? { runAttemptId: attemptContext.runAttemptId }
            : {}),
        });
        try {
          // Do not surface local gateway baseUrl/port to the user — internal orchestration only.
          deps.updateThread(input.thread.id, {
            status: "running",
            message: "",
          });
          const driver = getPiCodingAgentDriver(deps.ecoDataDir);
          const events = driver.run({
            threadId: input.thread.id,
            prompt: input.prompt,
            workspacePath: input.workspace.path,
            worktreePath: cwd,
            routes: driverRoutes,
            signal: controller.signal,
            piSession: {
              skillPaths: input.skillPaths ?? [],
              ...(input.mcpServers && Object.keys(input.mcpServers).length > 0
                ? { mcpServers: input.mcpServers }
                : {}),
              ...(input.appendSystemPrompt && input.appendSystemPrompt.length > 0
                ? { appendSystemPrompt: input.appendSystemPrompt }
                : {}),
              ...(diskResume
                ? {
                    sessionFile: diskResume.sessionFile,
                    resumeIdentityFingerprint: diskResume.resumeIdentityFingerprint,
                    resumeMcpFingerprint: diskResume.resumeMcpFingerprint,
                  }
                : {}),
            },
          });

          // Capture session.captured binding while streaming.
          async function* intercept(): AsyncIterable<AgentEvent> {
            for await (const event of events) {
              if (event.type === "session.captured") {
                const payload = event.payload as {
                  sessionId?: string;
                  cwd?: string;
                  sessionFile?: string;
                  identityFingerprint?: string;
                  mcpFingerprint?: string;
                };
                if (payload.sessionId && payload.cwd) {
                  deps.captureSession(input.thread.id, payload.sessionId, payload.cwd, {
                    ...(payload.sessionFile ? { sessionFile: payload.sessionFile } : {}),
                    ...(payload.identityFingerprint
                      ? { identityFingerprint: payload.identityFingerprint }
                      : {}),
                    ...(payload.mcpFingerprint !== undefined
                      ? { mcpFingerprint: payload.mcpFingerprint }
                      : {}),
                  });
                }
              }
              yield event;
            }
          }

          return await deps.consumeEvents({
            events: intercept(),
            threadId: input.thread.id,
            worktreePath: cwd,
            signal: controller.signal,
          });
        } finally {
          armedBindingByThread.delete(input.thread.id);
          await binding.close();
        }
      },
    );

    await deps.applyRunDecision({ threadId: input.thread.id, decision: outcome });
  } catch (error) {
    deps.markInterrupted(input.thread.id, deps.errorMessage(error));
  } finally {
    await deps.finalizeCleanup(input.thread.id);
  }
}

export async function abortPiThread(threadId: string): Promise<void> {
  await globalPiSessionRegistry.abort(threadId);
}

export function disposePiThreadSession(threadId: string): void {
  globalPiSessionRegistry.delete(threadId);
}

/** Remove Eco-owned `pi-agent/<threadId>` tree after disposing the in-process session. */
export async function removePiThreadAgentDir(
  ecoDataDir: string,
  threadId: string,
): Promise<void> {
  await removePiAgentThreadDir(ecoDataDir, threadId);
}

/**
 * Resolve disk-resume fields from a stored PI core session binding.
 * Driver still validates identity/MCP fingerprints against the live run.
 */
export function resolvePiDiskResume(input: {
  binding:
    | {
        coreKind: string;
        externalSessionId: string;
        cwd: string;
        metadata?: Record<string, unknown>;
      }
    | undefined;
  cwd: string;
}):
  | {
      sessionFile: string;
      resumeIdentityFingerprint: string;
      resumeMcpFingerprint: string;
    }
  | undefined {
  const binding = input.binding;
  if (!binding || binding.coreKind !== "pi") {
    return undefined;
  }
  if (path.resolve(binding.cwd) !== path.resolve(input.cwd)) {
    return undefined;
  }
  const metadata = binding.metadata ?? {};
  const sessionFile =
    typeof metadata.sessionFile === "string" ? metadata.sessionFile.trim() : "";
  const identityFingerprint =
    typeof metadata.identityFingerprint === "string"
      ? metadata.identityFingerprint.trim()
      : "";
  if (!sessionFile || !identityFingerprint) {
    return undefined;
  }
  const mcpFingerprint =
    typeof metadata.mcpFingerprint === "string" ? metadata.mcpFingerprint.trim() : "";
  return {
    sessionFile,
    resumeIdentityFingerprint: identityFingerprint,
    resumeMcpFingerprint: mcpFingerprint,
  };
}
