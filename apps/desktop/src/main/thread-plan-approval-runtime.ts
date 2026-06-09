import type { RuntimeRoleRouteConfig, ThreadSummary } from "../shared/ipc";
import type { ThreadPendingPlanWithRoutes } from "./thread-plan-ready-effects";
import type { RuntimeConfig, RuntimeConfigResolution } from "./thread-runtime-routes";

export type ThreadPlanApprovalLaunchMode = "execution";

export interface ThreadPlanApprovalRuntimeServices {
  getThread(threadId: string): ThreadSummary | undefined;
  hasActiveRun(threadId: string): boolean;
  getPendingPlan(threadId: string): ThreadPendingPlanWithRoutes | undefined;
  resolveRoleRoutes(threadId: string): readonly RuntimeRoleRouteConfig[];
  resolveRuntimeConfig(routes: readonly RuntimeRoleRouteConfig[]): RuntimeConfigResolution;
}

export interface ThreadPlanApprovalRuntime {
  thread: ThreadSummary;
  pendingPlan: ThreadPendingPlanWithRoutes;
  roleRoutes: readonly RuntimeRoleRouteConfig[];
  runtimeConfig: RuntimeConfig;
  launchMode: ThreadPlanApprovalLaunchMode;
}

export function resolveThreadPlanApprovalRuntime(
  threadId: string,
  services: ThreadPlanApprovalRuntimeServices,
): ThreadPlanApprovalRuntime {
  const thread = services.getThread(threadId);
  if (!thread) {
    throw new Error("Thread was not found.");
  }
  if (thread.status !== "awaiting_plan") {
    throw new Error("This thread is not waiting for plan approval.");
  }
  if (services.hasActiveRun(threadId)) {
    throw new Error("Thread is already running.");
  }

  const pendingPlan = services.getPendingPlan(threadId);
  if (!pendingPlan) {
    throw new Error("找不到待批准的计划。");
  }
  if (!pendingPlan.plan.trim()) {
    throw new Error("计划内容不能为空。");
  }

  const roleRoutes = services.resolveRoleRoutes(threadId);
  const runtimeConfig = services.resolveRuntimeConfig(roleRoutes);
  if (!runtimeConfig.ok) {
    throw new Error(runtimeConfig.reason);
  }

  return {
    thread,
    pendingPlan,
    roleRoutes,
    runtimeConfig: { routes: runtimeConfig.routes },
    launchMode: "execution",
  };
}
