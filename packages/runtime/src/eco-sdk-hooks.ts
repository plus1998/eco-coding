import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  NotificationHookInput,
  PreToolUseHookInput,
  StopHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
  TaskCompletedHookInput,
  TaskCreatedHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { parseAskUserQuestionInput, type SdkAskUserQuestionRequest } from "./ask-user-question";
import { parseFinalizePlanInput, type SdkFinalizePlanRequest } from "./finalize-plan";
import { appendReviewerScopeToPrompt } from "./reviewer-scope";
import {
  isSubagentEnabled,
  normalizeSubagentAvailability,
  SUBAGENT_ROLES,
  type SubagentAvailability,
  type SubagentRole,
} from "./subagent-availability";

export interface EcoTaskTrackerHooks {
  onPreToolUse(toolName: string, input: Record<string, unknown>): void;
  onTaskCreated(input: { taskId: string; subject: string; description?: string }): void;
  onTaskCompleted(input: { taskId: string; subject: string }): void;
  onSubagentStart(input: { agentId: string; agentType: string }): void;
  onSubagentStop(input: { agentId: string; agentType: string }): void;
  onStop(status: "completed" | "blocked" | "cancelled"): void;
}

export interface EcoHookContext {
  resolveChangedFiles?: () => Promise<readonly string[]>;
  askUserQuestion?: (
    request: SdkAskUserQuestionRequest & { toolUseId: string },
  ) => Promise<Record<string, unknown>>;
  finalizePlan?: (
    request: SdkFinalizePlanRequest & { toolUseId: string },
  ) => Promise<Record<string, unknown>>;
  taskTracker?: EcoTaskTrackerHooks;
  onNotification?: (input: { message: string; title?: string; notificationType: string }) => void;
  getStopTodoStatus?: () => "completed" | "blocked" | "cancelled";
  subagentAvailability?: SubagentAvailability;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAgentSubagentType(input: Record<string, unknown>): string | undefined {
  if (typeof input.subagent_type === "string" && input.subagent_type.trim()) {
    return input.subagent_type.trim();
  }
  if (typeof input.agent_type === "string" && input.agent_type.trim()) {
    return input.agent_type.trim();
  }
  return undefined;
}

export function createAskUserQuestionPreToolHook(
  delegate: EcoHookContext["askUserQuestion"],
): HookCallback | undefined {
  if (!delegate) {
    return undefined;
  }

  return async (input, toolUseID) => {
    if (input.hook_event_name !== "PreToolUse") {
      return {};
    }
    const preInput = input as PreToolUseHookInput;
    if (preInput.tool_name !== "AskUserQuestion") {
      return {};
    }

    const toolInput = isRecord(preInput.tool_input) ? preInput.tool_input : {};
    const parsed = parseAskUserQuestionInput(toolInput);
    const updatedInput = await delegate({
      ...parsed,
      toolUseId: toolUseID ?? preInput.tool_use_id,
    });

    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput,
      },
    };
  };
}

export function createFinalizePlanPreToolHook(
  delegate: EcoHookContext["finalizePlan"],
): HookCallback | undefined {
  if (!delegate) {
    return undefined;
  }

  return async (input, toolUseID) => {
    if (input.hook_event_name !== "PreToolUse") {
      return {};
    }
    const preInput = input as PreToolUseHookInput;
    if (preInput.tool_name !== "FinalizePlan") {
      return {};
    }

    const toolInput = isRecord(preInput.tool_input) ? preInput.tool_input : {};
    const parsed = parseFinalizePlanInput(toolInput);
    const updatedInput = await delegate({
      ...parsed,
      toolUseId: toolUseID ?? preInput.tool_use_id,
    });

    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput,
      },
    };
  };
}

function isSubagentRole(role: string): role is SubagentRole {
  return (SUBAGENT_ROLES as readonly string[]).includes(role);
}

export function createDisabledSubagentPreToolHook(
  availability?: SubagentAvailability,
): HookCallback | undefined {
  const resolved = availability ?? normalizeSubagentAvailability();
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") {
      return {};
    }
    const preInput = input as PreToolUseHookInput;
    if (preInput.tool_name !== "Agent") {
      return {};
    }
    const toolInput = isRecord(preInput.tool_input) ? preInput.tool_input : {};
    const subagentType = readAgentSubagentType(toolInput);
    if (!subagentType || !isSubagentRole(subagentType)) {
      return {};
    }
    if (isSubagentEnabled(resolved, subagentType)) {
      return {};
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Subagent "${subagentType}" is disabled in Eco settings. Do not call Agent(${subagentType}).`,
      },
    };
  };
}

export function createReviewerScopePreToolHook(
  resolveChangedFiles: EcoHookContext["resolveChangedFiles"],
): HookCallback | undefined {
  if (!resolveChangedFiles) {
    return undefined;
  }

  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") {
      return {};
    }
    const preInput = input as PreToolUseHookInput;
    if (preInput.tool_name !== "Agent") {
      return {};
    }
    const toolInput = isRecord(preInput.tool_input) ? preInput.tool_input : {};
    if (readAgentSubagentType(toolInput) !== "reviewer") {
      return {};
    }

    const changedFiles = await resolveChangedFiles();
    const prompt = typeof toolInput.prompt === "string" ? toolInput.prompt : "";
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: {
          ...toolInput,
          prompt: appendReviewerScopeToPrompt(prompt, changedFiles),
        },
      },
    };
  };
}

export function createTaskToolPreToolHook(taskTracker: EcoTaskTrackerHooks): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") {
      return {};
    }
    const preInput = input as PreToolUseHookInput;
    const toolInput = isRecord(preInput.tool_input) ? preInput.tool_input : {};
    taskTracker.onPreToolUse(preInput.tool_name, toolInput);
    return {};
  };
}

export function createTaskCreatedHook(taskTracker: EcoTaskTrackerHooks): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "TaskCreated") {
      return {};
    }
    const created = input as TaskCreatedHookInput;
    taskTracker.onTaskCreated({
      taskId: created.task_id,
      subject: created.task_subject,
      ...(created.task_description ? { description: created.task_description } : {}),
    });
    return {};
  };
}

export function createTaskCompletedHook(taskTracker: EcoTaskTrackerHooks): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "TaskCompleted") {
      return {};
    }
    const completed = input as TaskCompletedHookInput;
    taskTracker.onTaskCompleted({
      taskId: completed.task_id,
      subject: completed.task_subject,
    });
    return {};
  };
}

export function createSubagentStartHook(taskTracker: EcoTaskTrackerHooks): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "SubagentStart") {
      return {};
    }
    const started = input as SubagentStartHookInput;
    taskTracker.onSubagentStart({
      agentId: started.agent_id,
      agentType: started.agent_type,
    });
    return {};
  };
}

export function createSubagentStopHook(taskTracker: EcoTaskTrackerHooks): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "SubagentStop") {
      return {};
    }
    const stopped = input as SubagentStopHookInput;
    taskTracker.onSubagentStop({
      agentId: stopped.agent_id,
      agentType: stopped.agent_type,
    });
    return {};
  };
}

export function createStopHook(ctx: EcoHookContext): HookCallback | undefined {
  if (!ctx.taskTracker) {
    return undefined;
  }

  return async (input) => {
    if (input.hook_event_name !== "Stop") {
      return {};
    }
    const stopInput = input as StopHookInput;
    if (stopInput.stop_hook_active) {
      return {};
    }
    const status = ctx.getStopTodoStatus?.() ?? "completed";
    ctx.taskTracker?.onStop(status);
    return {};
  };
}

export function createNotificationHook(
  onNotification: EcoHookContext["onNotification"],
): HookCallback | undefined {
  if (!onNotification) {
    return undefined;
  }

  return async (input) => {
    if (input.hook_event_name !== "Notification") {
      return {};
    }
    const notification = input as NotificationHookInput;
    onNotification({
      message: notification.message,
      ...(notification.title ? { title: notification.title } : {}),
      notificationType: notification.notification_type,
    });
    return { async: true, asyncTimeout: 5000 };
  };
}

function pushMatcher(
  hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>,
  event: HookEvent,
  matcher: HookCallbackMatcher,
): void {
  const existing = hooks[event];
  if (existing) {
    existing.push(matcher);
    return;
  }
  hooks[event] = [matcher];
}

function pushHook(
  hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>,
  event: HookEvent,
  callback: HookCallback | undefined,
  matcher?: string,
): void {
  if (!callback) {
    return;
  }
  pushMatcher(hooks, event, {
    ...(matcher ? { matcher } : {}),
    hooks: [callback],
  });
}

/** Build SDK callback hooks for eco-coding thread sessions. */
export function buildEcoSdkHooks(ctx: EcoHookContext): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};

  const availability = ctx.subagentAvailability ?? normalizeSubagentAvailability();

  pushHook(hooks, "PreToolUse", createAskUserQuestionPreToolHook(ctx.askUserQuestion), "AskUserQuestion");
  pushHook(hooks, "PreToolUse", createFinalizePlanPreToolHook(ctx.finalizePlan), "FinalizePlan");
  pushHook(hooks, "PreToolUse", createDisabledSubagentPreToolHook(availability), "Agent");
  pushHook(hooks, "PreToolUse", createReviewerScopePreToolHook(ctx.resolveChangedFiles), "Agent");

  if (ctx.taskTracker) {
    pushHook(hooks, "PreToolUse", createTaskToolPreToolHook(ctx.taskTracker), "TaskCreate|TaskUpdate|TodoWrite");
    pushHook(hooks, "TaskCreated", createTaskCreatedHook(ctx.taskTracker));
    pushHook(hooks, "TaskCompleted", createTaskCompletedHook(ctx.taskTracker));
    pushHook(hooks, "SubagentStart", createSubagentStartHook(ctx.taskTracker));
    pushHook(hooks, "SubagentStop", createSubagentStopHook(ctx.taskTracker));
    pushHook(hooks, "Stop", createStopHook(ctx));
  }

  pushHook(hooks, "Notification", createNotificationHook(ctx.onNotification));

  return hooks;
}
