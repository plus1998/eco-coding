import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
  NotificationHookInput,
  PreCompactHookInput,
  PreToolUseHookInput,
  StopHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
  TaskCompletedHookInput,
  TaskCreatedHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { parseAskUserQuestionInput, type SdkAskUserQuestionRequest } from "./ask-user-question";
import { appendReviewerScopeToPrompt } from "./reviewer-scope";
import {
  createSubagentMissionCapturePreToolHook,
  createSubagentResumePreToolHook,
  normalizeAgentToolInputSubagentType,
  normalizeSdkSubagentType,
  readAgentSubagentType,
  type SubagentResumeResolveInput,
} from "./subagent-resume.js";

export {
  normalizeAgentToolInputSubagentType,
  normalizeSdkSubagentType,
  readAgentSubagentType,
} from "./subagent-resume.js";
import type { AgentRole } from "../../shared/src";
import {
  isSubagentEnabled,
  normalizeSubagentAvailability,
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
  peekPendingCoderTodoId?: () => string | undefined;
}

export interface EcoPreCompactHookInput {
  trigger: "auto" | "manual";
  sessionId?: string;
}

export type SubagentRunPhase = "planning" | "execution" | "question";

export interface EcoSubagentSessionHooks {
  phase: SubagentRunPhase;
  threadId: string;
  onStart(input: { agentId: string; agentType: string; prompt?: string; todoId?: string }): void;
  onStop(input: { agentId: string; agentType: string }): void;
  resolveResume(input: SubagentResumeResolveInput): string | undefined;
  todoIdHint?: () => string | undefined;
  onAgentToolCapture?: (input: { role: SubagentRole; prompt: string; todoIdHint?: string }) => void;
}

export interface EcoSubagentAttributionHooks {
  resolveAgentId?(input: {
    role: AgentRole;
    parentToolUseId?: string;
    sessionId: string;
  }): string | undefined;
  onTaskToolUse?(toolUseId: string, input?: { role?: SubagentRole }): void;
}

export interface EcoHookContext {
  resolveChangedFiles?: () => Promise<readonly string[]>;
  askUserQuestion?: (
    request: SdkAskUserQuestionRequest & { toolUseId: string },
  ) => Promise<Record<string, unknown>>;
  taskTracker?: EcoTaskTrackerHooks;
  subagentSessions?: EcoSubagentSessionHooks;
  subagentAttribution?: EcoSubagentAttributionHooks;
  onNotification?: (input: { message: string; title?: string; notificationType: string }) => void;
  onPreCompact?: (input: EcoPreCompactHookInput) => Promise<void>;
  getStopTodoStatus?: () => "completed" | "blocked" | "cancelled";
  subagentAvailability?: SubagentAvailability;
  allowedAgentKeys?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createWorkflowDenyPreToolHook(): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") {
      return {};
    }
    const preInput = input as PreToolUseHookInput;
    if (preInput.tool_name !== "Workflow") {
      return {};
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "SDK Dynamic Workflows are disabled in Eco. Orchestrate with Eco Agent keys instead.",
      },
    };
  };
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

export function createNormalizeSubagentPreToolHook(): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") {
      return {};
    }
    const preInput = input as PreToolUseHookInput;
    if (preInput.tool_name !== "Agent" && preInput.tool_name !== "Task") {
      return {};
    }
    const toolInput = isRecord(preInput.tool_input) ? preInput.tool_input : {};
    const normalized = normalizeAgentToolInputSubagentType(toolInput);
    if (!normalized.changed) {
      return {};
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: normalized.input,
      },
    };
  };
}

export function createNonEcoSubagentDenyPreToolHook(allowedAgentKeys: readonly string[] = []): HookCallback {
  const allowed = new Set(allowedAgentKeys);
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") {
      return {};
    }
    const preInput = input as PreToolUseHookInput;
    if (preInput.tool_name !== "Agent" && preInput.tool_name !== "Task") {
      return {};
    }
    const toolInput = isRecord(preInput.tool_input) ? preInput.tool_input : {};
    const rawType = readAgentSubagentType(toolInput);
    if (!rawType) {
      return {};
    }
    if (normalizeSdkSubagentType(rawType)) {
      return {};
    }
    if (allowed.has(rawType)) {
      return {};
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Subagent "${rawType}" is not an Eco agent. Use listed Eco agent keys only (see Available Eco subagents in system prompt).`,
      },
    };
  };
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
    if (preInput.tool_name !== "Agent" && preInput.tool_name !== "Task") {
      return {};
    }
    const toolInput = isRecord(preInput.tool_input) ? preInput.tool_input : {};
    const rawType = readAgentSubagentType(toolInput);
    const subagentType = rawType ? normalizeSdkSubagentType(rawType) : undefined;
    if (!subagentType) {
      return {};
    }
    if (isSubagentEnabled(resolved, subagentType)) {
      return {};
    }
    const deniedLabel = rawType ?? subagentType;
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Subagent "${deniedLabel}" is disabled in Eco settings. Do not call Agent(${deniedLabel}).`,
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
    if (preInput.tool_name !== "Agent" && preInput.tool_name !== "Task") {
      return {};
    }
    const rawToolInput = isRecord(preInput.tool_input) ? preInput.tool_input : {};
    const { input: toolInput, role } = normalizeAgentToolInputSubagentType(rawToolInput);
    if (role !== "reviewer") {
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

export function createSubagentToolAttributionPreToolHook(
  attribution?: EcoSubagentAttributionHooks,
): HookCallback | undefined {
  if (!attribution?.onTaskToolUse) {
    return undefined;
  }
  const onTaskToolUse = attribution.onTaskToolUse;
  return async (input, toolUseID) => {
    if (input.hook_event_name !== "PreToolUse") {
      return {};
    }
    const preInput = input as PreToolUseHookInput;
    if (typeof toolUseID === "string" && (preInput.tool_name === "Task" || preInput.tool_name === "Agent")) {
      const toolInput = isRecord(preInput.tool_input) ? preInput.tool_input : {};
      const role = normalizeSdkSubagentType(readAgentSubagentType(toolInput) ?? "");
      onTaskToolUse(toolUseID, role ? { role } : undefined);
    }
    return {};
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

export function createSubagentStartHook(handlers: {
  taskTracker?: EcoTaskTrackerHooks;
  subagentSessions?: EcoSubagentSessionHooks;
}): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "SubagentStart") {
      return {};
    }
    const started = input as SubagentStartHookInput;
    const agentType = normalizeSdkSubagentType(started.agent_type) ?? started.agent_type;
    const payload = {
      agentId: started.agent_id,
      agentType,
    };
    handlers.taskTracker?.onSubagentStart(payload);
    handlers.subagentSessions?.onStart(payload);
    return {};
  };
}

export function createSubagentStopHook(handlers: {
  taskTracker?: EcoTaskTrackerHooks;
  subagentSessions?: EcoSubagentSessionHooks;
}): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "SubagentStop") {
      return {};
    }
    const stopped = input as SubagentStopHookInput;
    const agentType = normalizeSdkSubagentType(stopped.agent_type) ?? stopped.agent_type;
    const payload = {
      agentId: stopped.agent_id,
      agentType,
    };
    handlers.taskTracker?.onSubagentStop(payload);
    handlers.subagentSessions?.onStop(payload);
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

export function createPreCompactHook(onPreCompact: EcoHookContext["onPreCompact"]): HookCallback | undefined {
  if (!onPreCompact) {
    return undefined;
  }

  return async (input) => {
    if (input.hook_event_name !== "PreCompact") {
      return {};
    }
    const preInput = input as PreCompactHookInput;
    await onPreCompact({
      trigger: preInput.trigger,
      sessionId: preInput.session_id,
    });
    return {};
  };
}

export function createNotificationHook(
  onNotification: EcoHookContext["onNotification"],
): HookCallback | undefined {
  if (!onNotification) {
    return undefined;
  }

  const hook: HookCallback = async (input) => {
    if (input.hook_event_name !== "Notification") {
      const output: HookJSONOutput = {};
      return output;
    }
    const notification = input as NotificationHookInput;
    onNotification({
      message: notification.message,
      ...(notification.title ? { title: notification.title } : {}),
      notificationType: notification.notification_type,
    });
    return { async: true, asyncTimeout: 5000 };
  };
  return hook;
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

  pushHook(hooks, "PreToolUse", createWorkflowDenyPreToolHook(), "Workflow");
  pushHook(hooks, "PreToolUse", createAskUserQuestionPreToolHook(ctx.askUserQuestion), "AskUserQuestion");
  pushHook(hooks, "PreToolUse", createNormalizeSubagentPreToolHook(), "Agent|Task");
  pushHook(hooks, "PreToolUse", createNonEcoSubagentDenyPreToolHook(ctx.allowedAgentKeys), "Agent|Task");
  pushHook(hooks, "PreToolUse", createDisabledSubagentPreToolHook(availability), "Agent|Task");
  if (ctx.subagentSessions) {
    const sessions = ctx.subagentSessions;
    if (sessions.onAgentToolCapture) {
      pushHook(
        hooks,
        "PreToolUse",
        createSubagentMissionCapturePreToolHook(sessions.onAgentToolCapture),
        "Agent|Task",
      );
    }
    pushHook(
      hooks,
      "PreToolUse",
      createSubagentResumePreToolHook(
        sessions.threadId,
        sessions.phase,
        sessions.resolveResume,
        sessions.todoIdHint ? { todoIdHint: sessions.todoIdHint } : undefined,
      ),
      "Agent|Task",
    );
  }
  pushHook(hooks, "PreToolUse", createReviewerScopePreToolHook(ctx.resolveChangedFiles), "Agent|Task");
  pushHook(
    hooks,
    "PreToolUse",
    createSubagentToolAttributionPreToolHook(ctx.subagentAttribution),
    "Agent|Task",
  );

  const subagentHandlers = {
    ...(ctx.taskTracker && { taskTracker: ctx.taskTracker }),
    ...(ctx.subagentSessions && { subagentSessions: ctx.subagentSessions }),
  };
  if (subagentHandlers.taskTracker || subagentHandlers.subagentSessions) {
    pushHook(hooks, "SubagentStart", createSubagentStartHook(subagentHandlers));
    pushHook(hooks, "SubagentStop", createSubagentStopHook(subagentHandlers));
  }

  if (ctx.taskTracker) {
    pushHook(
      hooks,
      "PreToolUse",
      createTaskToolPreToolHook(ctx.taskTracker),
      "TaskCreate|TaskUpdate|TodoWrite",
    );
    pushHook(hooks, "TaskCreated", createTaskCreatedHook(ctx.taskTracker));
    pushHook(hooks, "TaskCompleted", createTaskCompletedHook(ctx.taskTracker));
    pushHook(hooks, "Stop", createStopHook(ctx));
  }

  pushHook(hooks, "Notification", createNotificationHook(ctx.onNotification));
  pushHook(hooks, "PreCompact", createPreCompactHook(ctx.onPreCompact));

  return hooks;
}
