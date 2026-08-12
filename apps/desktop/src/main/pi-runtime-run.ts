import path from "node:path";
import type { WorktreePlan } from "@eco/workspace";
import type { ResolvedModelRoute } from "@eco/model-router";
import {
  type AgentEvent,
  type CoreKind,
  PiCodingAgentDriver,
  globalPiSessionRegistry,
  probePiCoreAvailability,
  resolvePiPlannerRoute,
} from "@eco/runtime";
import type { PromptImageAttachment, ThreadSummary, WorkspaceInfo } from "../shared/ipc";
import type { StartedAnthropicProxy } from "./anthropic-proxy";
import type { ActiveRunRuntimeStateInput } from "./active-run-runtime-state";
import type { RuntimeRoute } from "./billing-resolver";
import type { RequestAttemptResult } from "./request-retry";
import { buildDriverRoutes } from "./thread-runtime-routes";
import type { RunAttemptContext } from "./thread-run-attempt";

export interface PiThreadStartRunInput {
  thread: ThreadSummary;
  workspace: WorkspaceInfo;
  runtimeConfig: { routes: RuntimeRoute[] };
  prompt: string;
  attachments?: PromptImageAttachment[];
  roleRoutes?: unknown;
  continuation?: boolean;
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
  startRuntimeProxy: (
    routes: RuntimeRoute[],
    attachments: PromptImageAttachment[] | undefined,
    context: RunAttemptContext,
  ) => Promise<StartedAnthropicProxy>;
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
  captureSession: (threadId: string, sessionId: string, cwd: string) => void;
  errorMessage: (error: unknown) => string;
}

/** Shared driver resolveBridge uses the most recently armed proxy per thread. */
const armedProxyByThread = new Map<
  string,
  { proxy: StartedAnthropicProxy; driverRoutes: ResolvedModelRoute[]; agentDir: string }
>();

let sharedDriver: PiCodingAgentDriver | undefined;

export function getPiCodingAgentDriver(ecoDataDir: string): PiCodingAgentDriver {
  if (!sharedDriver) {
    sharedDriver = new PiCodingAgentDriver({
      resolveBridgeModel: async ({ threadId, routes }) => {
        const armed = armedProxyByThread.get(threadId);
        if (!armed) {
          throw new Error("PI bridge proxy is not armed for this thread.");
        }
        const planner =
          armed.proxy.routes.find((route) => route.role === "planner") ?? armed.proxy.routes[0];
        if (!planner) {
          throw new Error("PI proxy has no model routes.");
        }
        const plannerRoute = resolvePiPlannerRoute(routes);
        return {
          bridgeBaseUrl: armed.proxy.baseUrl,
          bridgeModelId: planner.aliasModelId,
          apiKey: armed.proxy.apiKey,
          agentDir: armed.agentDir,
          ...(plannerRoute?.primary.contextWindow !== undefined && {
            contextWindow: plannerRoute.primary.contextWindow,
          }),
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
        const proxy = await deps.startRuntimeProxy(
          config.routes,
          input.attachments,
          attemptContext,
        );
        const agentDir = path.join(deps.ecoDataDir, "pi-agent", input.thread.id);
        const driverRoutes = buildDriverRoutes(proxy.routes);
        armedProxyByThread.set(input.thread.id, { proxy, driverRoutes, agentDir });
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
          });

          // Capture session.captured binding while streaming.
          async function* intercept(): AsyncIterable<AgentEvent> {
            for await (const event of events) {
              if (event.type === "session.captured") {
                const payload = event.payload as { sessionId?: string; cwd?: string };
                if (payload.sessionId && payload.cwd) {
                  deps.captureSession(input.thread.id, payload.sessionId, payload.cwd);
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
          armedProxyByThread.delete(input.thread.id);
          await proxy.close();
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
