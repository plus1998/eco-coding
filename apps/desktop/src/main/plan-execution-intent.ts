import type { RuntimeRoleRouteConfig } from "../shared/ipc";
import type { RuntimeConfig } from "./thread-runtime-routes";

export interface PlanExecutionIntent {
  runtimeConfig: RuntimeConfig;
  roleRoutes?: readonly RuntimeRoleRouteConfig[];
}

const intents = new Map<string, PlanExecutionIntent>();

export function setPlanExecutionIntent(threadId: string, intent: PlanExecutionIntent): void {
  intents.set(threadId, intent);
}

export function takePlanExecutionIntent(threadId: string): PlanExecutionIntent | undefined {
  const intent = intents.get(threadId);
  if (!intent) {
    return undefined;
  }
  intents.delete(threadId);
  return intent;
}

export function clearPlanExecutionIntent(threadId: string): void {
  intents.delete(threadId);
}

export function hasPlanExecutionIntent(threadId: string): boolean {
  return intents.has(threadId);
}
