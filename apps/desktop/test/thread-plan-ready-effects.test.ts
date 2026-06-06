import { expect, test } from "bun:test";
import {
  applyThreadPlanReadyEffects,
  type ThreadPlanReadyAwaitingPlanEvent,
  type ThreadPendingPlanWithRoutes,
} from "../src/main/thread-plan-ready-effects";

test("applyThreadPlanReadyEffects persists plan, emits awaiting event, and schedules title", () => {
  const savedPlans: ThreadPendingPlanWithRoutes[] = [];
  const emittedEvents: ThreadPlanReadyAwaitingPlanEvent[] = [];
  const titleContexts: Array<{ threadId: string; analysis: string; plan: string }> = [];

  const result = applyThreadPlanReadyEffects({
    threadId: "thr_plan_ready",
    payload: {
      userPrompt: "Build billing ledger",
      analysis: "Need a stable ledger domain.",
      plan: "1. Capture usage events\n2. Project billing",
    },
    workspacePath: "/repo",
    worktreePath: "/repo/.worktrees/thr_plan_ready",
    routesJson: '{"planner":"model_planner"}',
    awaitingPlanMessage: "计划已生成，请确认是否执行。",
    effects: {
      savePendingPlan: (plan) => {
        savedPlans.push(plan);
      },
      emitAwaitingPlan: (event) => {
        emittedEvents.push(event);
      },
      scheduleTitleSummary: (threadId, context) => {
        titleContexts.push({ threadId, ...context });
      },
    },
  });

  expect(result).toEqual({
    planCaptured: true,
    pendingPlan: {
      threadId: "thr_plan_ready",
      userPrompt: "Build billing ledger",
      analysis: "Need a stable ledger domain.",
      plan: "1. Capture usage events\n2. Project billing",
      workspacePath: "/repo",
      worktreePath: "/repo/.worktrees/thr_plan_ready",
      routesJson: '{"planner":"model_planner"}',
    },
  });
  expect(savedPlans).toEqual([result.pendingPlan]);
  expect(emittedEvents).toEqual([
    {
      threadId: "thr_plan_ready",
      message: "计划已生成，请确认是否执行。",
      plan: {
        userPrompt: "Build billing ledger",
        analysis: "Need a stable ledger domain.",
        plan: "1. Capture usage events\n2. Project billing",
      },
    },
  ]);
  expect(titleContexts).toEqual([
    {
      threadId: "thr_plan_ready",
      analysis: "Need a stable ledger domain.",
      plan: "1. Capture usage events\n2. Project billing",
    },
  ]);
});

test("applyThreadPlanReadyEffects keeps caller-specific awaiting messages out of persisted plan", () => {
  const savedPlans: ThreadPendingPlanWithRoutes[] = [];
  const emittedEvents: ThreadPlanReadyAwaitingPlanEvent[] = [];

  applyThreadPlanReadyEffects({
    threadId: "thr_autonomous_plan",
    payload: {
      userPrompt: "Audit subagents",
      analysis: "Review lifecycle first.",
      plan: "Inspect attribution.",
    },
    workspacePath: "/repo",
    worktreePath: "/repo",
    routesJson: "{}",
    awaitingPlanMessage: "Agent 请求确认计划，请审批后继续。",
    effects: {
      savePendingPlan: (plan) => savedPlans.push(plan),
      emitAwaitingPlan: (event) => emittedEvents.push(event),
      scheduleTitleSummary: () => {},
    },
  });

  expect(savedPlans[0]?.plan).toBe("Inspect attribution.");
  expect(savedPlans[0]).not.toHaveProperty("message");
  expect(emittedEvents[0]?.message).toBe("Agent 请求确认计划，请审批后继续。");
});
