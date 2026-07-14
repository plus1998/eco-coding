import type { EcoPlanningContext, PlanHandoffChoice } from "@eco/runtime";
import type { PlanApprovalRequest } from "../shared/ipc";
import type { ThreadPendingPlanWithRoutes } from "./thread-plan-ready-effects";

export const DEFAULT_PLAN_HANDOFF_CHOICE: PlanHandoffChoice = "same_thread";

export function resolvePlanHandoffChoice(choice?: PlanHandoffChoice): PlanHandoffChoice {
  if (choice === "fork_thread" || choice === "continue_plan" || choice === "same_thread") {
    return choice;
  }
  return DEFAULT_PLAN_HANDOFF_CHOICE;
}

export function buildPlanHandoffPlanningContext(
  pending: Pick<PlanApprovalRequest, "userPrompt" | "analysis" | "plan" | "planFilePath">,
  options: {
    handoffChoice: PlanHandoffChoice;
    userFollowUp?: string;
    planUserEdited?: boolean;
  },
): EcoPlanningContext {
  return {
    userPrompt: pending.userPrompt,
    analysis: pending.analysis,
    plan: pending.plan,
    handoffChoice: options.handoffChoice,
    ...(pending.planFilePath ? { planFilePath: pending.planFilePath } : {}),
    ...(options.planUserEdited ? { planUserEdited: true } : {}),
    ...(options.userFollowUp?.trim() ? { userFollowUp: options.userFollowUp.trim() } : {}),
  };
}

export function buildPlanHandoffFromPendingPlan(
  pending: ThreadPendingPlanWithRoutes,
  options: {
    handoffChoice: PlanHandoffChoice;
    userFollowUp?: string;
    planUserEdited?: boolean;
  },
): EcoPlanningContext {
  return buildPlanHandoffPlanningContext(pending, options);
}

export function planHandoffLaunchesExecution(choice: PlanHandoffChoice): boolean {
  return choice === "same_thread" || choice === "fork_thread";
}

export function planHandoffContinuePrompt(userFollowUp?: string): string {
  return userFollowUp?.trim() || "Please refine the plan based on my feedback.";
}
