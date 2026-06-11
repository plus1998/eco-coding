import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
  NotificationHookInput,
  PermissionRequestHookInput,
  PreCompactHookInput,
  PreToolUseHookInput,
  StopHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
  TaskCompletedHookInput,
  TaskCreatedHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { parseAskUserQuestionInput, type SdkAskUserQuestionRequest } from "./ask-user-question";
import {
  readLatestClaudePlanFile,
  readPlanFileContent,
  readPlanFromPhaseTranscript,
  readPlanFromSdkTranscriptPath,
} from "./plan-path.js";
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

import { evaluateBashPolicy, type BashReviewMode } from "../../bash-policy/src";
import type { RuntimeAgentRole } from "../../shared/src";
import type { EcoRuntimeToolPermissionEntry, EcoRuntimeToolPermissionPolicy } from "./agent-orchestration.js";
import {
  isSubagentEnabled,
  isSubagentRole,
  normalizeSubagentAvailability,
  SDK_GENERAL_PURPOSE_AGENT_KEY,
  SDK_PLAN_AGENT_KEY,
  type SubagentAvailability,
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
  onAgentToolCapture?: (input: { role: RuntimeAgentRole; prompt: string; todoIdHint?: string }) => void;
}

export interface EcoSubagentAttributionHooks {
  resolveAgentId?(input: {
    role: RuntimeAgentRole;
    parentToolUseId?: string;
    sessionId: string;
  }): string | undefined;
  onTaskToolUse?(toolUseId: string, input?: { role?: RuntimeAgentRole }): void;
}

export interface EcoHookContext {
  resolveChangedFiles?: () => Promise<readonly string[]>;
  askUserQuestion?: (
    request: SdkAskUserQuestionRequest & { toolUseId: string },
  ) => Promise<Record<string, unknown>>;
  onExitPlanMode?: (request: SdkExitPlanModeRequest & { toolUseId: string }) => void | Promise<void>;
  /** Tracks ExitPlanMode captures to avoid duplicate Pre/Post hook submissions. */
  exitPlanCaptureState?: { capturedToolUseIds: Set<string> };
  /** Execution resume: auto-approve the deferred ExitPlanMode call (official defer protocol step 5). */
  approveDeferredExitPlanMode?: boolean;
  taskTracker?: EcoTaskTrackerHooks;
  subagentSessions?: EcoSubagentSessionHooks;
  subagentAttribution?: EcoSubagentAttributionHooks;
  onNotification?: (input: { message: string; title?: string; notificationType: string }) => void;
  onPreCompact?: (input: EcoPreCompactHookInput) => Promise<void>;
  getStopTodoStatus?: () => "completed" | "blocked" | "cancelled";
  subagentAvailability?: SubagentAvailability;
  allowedAgentKeys?: string[];
  allowedSdkBuiltinAgentKeys?: string[];
  toolPermissions?: EcoRuntimeToolPermissionPolicy;
  bashReviewMode?: BashReviewMode;
  resolveBashReviewMode?: () => BashReviewMode;
  workspacePath?: string;
  /** In-memory planning transcript buffer (updated as SDK stream events arrive). */
  getPhaseTranscript?: () => string;
  onToolPermissionDecision?: (decision: EcoToolPermissionDecisionAudit) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const READ_FILESYSTEM_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead"]);
const WRITE_FILESYSTEM_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
export interface EcoToolPermissionDecisionAudit {
  permissionDecision: "deny";
  toolName: string;
  toolUseId: string;
  reason: string;
  actor: string;
  sessionId?: string;
  agentId?: string;
  agentType?: string;
  cwd: string;
}

export interface SdkExitPlanModeRequest {
  plan: string;
  planFilePath?: string;
  allowedPrompts?: unknown;
  rawInput: Record<string, unknown>;
}

export function parseExitPlanModeOutput(
  response: unknown,
): { plan: string; planFilePath?: string } | undefined {
  if (!isRecord(response)) {
    return undefined;
  }
  const plan = typeof response.plan === "string" ? response.plan.trim() : "";
  const planFilePath = readStringField(response, ["filePath", "file_path", "planFilePath", "plan_file_path"]);
  if (!plan && !planFilePath) {
    return undefined;
  }
  return {
    plan,
    ...(planFilePath ? { planFilePath } : {}),
  };
}

export function parseExitPlanModeInput(input: Record<string, unknown>): SdkExitPlanModeRequest {
  const plan = readStringField(input, ["plan", "planContent", "plan_content", "markdown", "content"]);
  const planFilePath = readStringField(input, [
    "planFilePath",
    "plan_file_path",
    "filePath",
    "file_path",
    "plan_filename",
    "plan_path",
  ]);
  const allowedPrompts = input.allowedPrompts ?? input.allowed_prompts;
  return {
    plan,
    ...(planFilePath ? { planFilePath } : {}),
    ...(allowedPrompts !== undefined ? { allowedPrompts } : {}),
    rawInput: input,
  };
}

function readStringField(input: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function markExitPlanCaptured(
  state: { capturedToolUseIds: Set<string> } | undefined,
  toolUseId: string,
): boolean {
  const id = toolUseId.trim();
  if (!id || !state) {
    return false;
  }
  if (state.capturedToolUseIds.has(id)) {
    return true;
  }
  state.capturedToolUseIds.add(id);
  return false;
}

function uniqueSearchRoots(roots: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const root of roots) {
    const trimmed = root?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    resolved.push(trimmed);
  }
  return resolved;
}

interface ExitPlanResolveOptions {
  searchRoots: readonly (string | undefined)[];
  transcriptPath?: string;
  getPhaseTranscript?: () => string;
}

function readHookTranscriptPath(hookInput: Record<string, unknown>): string | undefined {
  const value = hookInput.transcript_path;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function resolveExitPlanModeSubmission(
  parsed: SdkExitPlanModeRequest,
  options: ExitPlanResolveOptions,
): Promise<SdkExitPlanModeRequest> {
  if (parsed.plan.trim()) {
    return parsed;
  }
  const roots = uniqueSearchRoots(options.searchRoots);
  for (const root of roots) {
    if (parsed.planFilePath) {
      const planText = await readPlanFileContent(root, parsed.planFilePath);
      if (planText) {
        return { ...parsed, plan: planText };
      }
    }
  }
  for (const root of roots) {
    const latest = await readLatestClaudePlanFile(root);
    if (latest) {
      return {
        ...parsed,
        plan: latest.content,
        planFilePath: parsed.planFilePath || latest.planFilePath,
      };
    }
  }
  const transcriptPath = options.transcriptPath?.trim();
  if (transcriptPath) {
    const fromTranscriptFile = await readPlanFromSdkTranscriptPath(transcriptPath);
    if (fromTranscriptFile?.plan.trim()) {
      return { ...parsed, plan: fromTranscriptFile.plan };
    }
  }
  const phaseTranscript = options.getPhaseTranscript?.().trim();
  if (phaseTranscript) {
    const fromPhase = readPlanFromPhaseTranscript(phaseTranscript);
    if (fromPhase?.plan.trim()) {
      return { ...parsed, plan: fromPhase.plan };
    }
  }
  return parsed;
}

async function delegateExitPlanModeCapture(
  delegate: NonNullable<EcoHookContext["onExitPlanMode"]>,
  state: { capturedToolUseIds: Set<string> } | undefined,
  request: SdkExitPlanModeRequest & { toolUseId: string },
): Promise<boolean> {
  if (!request.plan.trim() || markExitPlanCaptured(state, request.toolUseId)) {
    return false;
  }
  await delegate(request);
  return true;
}

/**
 * PreToolUse (Eco two-phase plan): capture injected plan, then `defer` to end the planning session.
 * SDK layers this hook does NOT replace:
 * - `allowedTools` = allow-rules (auto-approve listed tools at evaluation step 5), NOT tool visibility.
 * - `disallowedTools` bare names = remove tools from model context.
 * - `canUseTool` = runtime approval gate for unresolved tools.
 * Do not list ExitPlanMode in `allowedTools` (would add an allow-rule). Eco ends phase 1 via `defer`, not PermissionRequest `allow`.
 */
export function createExitPlanModePreToolHook(
  delegate: EcoHookContext["onExitPlanMode"],
  state?: { capturedToolUseIds: Set<string> },
  options: { workspacePath?: string; getPhaseTranscript?: () => string } = {},
): HookCallback | undefined {
  if (!delegate) {
    return undefined;
  }

  return async (input, toolUseID) => {
    if (input.hook_event_name !== "PreToolUse") {
      return {};
    }
    const preInput = input as PreToolUseHookInput;
    if (preInput.tool_name !== "ExitPlanMode") {
      return {};
    }
    const toolUseId = toolUseID ?? preInput.tool_use_id;
    const toolInput = isRecord(preInput.tool_input) ? preInput.tool_input : {};
    const injectedInput = mergeExitPlanModeInjectedFields(toolInput, preInput);
    const hookRecord = preInput as unknown as Record<string, unknown>;
    const transcriptPath = readHookTranscriptPath(hookRecord);
    const resolved = await resolveExitPlanModeSubmission(parseExitPlanModeInput(injectedInput), {
      searchRoots: [options.workspacePath, preInput.cwd],
      ...(transcriptPath ? { transcriptPath } : {}),
      ...(options.getPhaseTranscript ? { getPhaseTranscript: options.getPhaseTranscript } : {}),
    });
    if (resolved.plan.trim()) {
      await delegateExitPlanModeCapture(delegate, state, { ...resolved, toolUseId });
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "defer",
          permissionDecisionReason:
            "Eco captured the plan for user approval. Planning session ends; execution starts after Eco approval.",
        },
      };
    }
    return {};
  };
}

/**
 * PermissionRequest fallback for ExitPlanMode.
 * Plannotator (single-session) returns `allow` here after the user approves in its hook UI.
 * Eco (two-phase) captures the plan and returns `deny` — approval happens in Eco UI, then a separate execution session runs.
 */
export function createExitPlanModePermissionRequestHook(
  delegate: EcoHookContext["onExitPlanMode"],
  state?: { capturedToolUseIds: Set<string> },
  options: { workspacePath?: string; getPhaseTranscript?: () => string } = {},
): HookCallback | undefined {
  if (!delegate) {
    return undefined;
  }

  return async (input) => {
    if (input.hook_event_name !== "PermissionRequest") {
      return {};
    }
    const requestInput = input as PermissionRequestHookInput;
    if (requestInput.tool_name !== "ExitPlanMode") {
      return {};
    }
    const toolInput = isRecord(requestInput.tool_input) ? requestInput.tool_input : {};
    const injectedInput = mergeExitPlanModeInjectedFields(
      toolInput,
      requestInput as unknown as PreToolUseHookInput,
    );
    const hookRecord = requestInput as unknown as Record<string, unknown>;
    const transcriptPath = readHookTranscriptPath(hookRecord);
    const resolved = await resolveExitPlanModeSubmission(parseExitPlanModeInput(injectedInput), {
      searchRoots: [options.workspacePath, requestInput.cwd],
      ...(transcriptPath ? { transcriptPath } : {}),
      ...(options.getPhaseTranscript ? { getPhaseTranscript: options.getPhaseTranscript } : {}),
    });
    const toolUseId = `permission:${requestInput.session_id}`;
    const captured = resolved.plan.trim()
      ? await delegateExitPlanModeCapture(delegate, state, { ...resolved, toolUseId })
      : false;

    return {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "deny",
          message: captured
            ? "Plan captured for Eco approval. Implementation starts only after you approve in Eco."
            : "ExitPlanMode requires plan content before Eco can present it for approval.",
          interrupt: true,
        },
      },
    };
  };
}

/**
 * PreToolUse (execution resume): complete the deferred ExitPlanMode call after Eco approval.
 * Official defer protocol: resume re-fires PreToolUse for the same tool call; the hook must
 * return `allow` + `updatedInput` (interactive tools reject a bare `allow` in `-p` mode).
 * Without this, the pending ExitPlanMode is synthesized as a rejection in the transcript,
 * which models can misread as "plan denied" (claude-code#34111).
 */
export function createExitPlanModeResumeApproveHook(): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") {
      return {};
    }
    const preInput = input as PreToolUseHookInput;
    if (preInput.tool_name !== "ExitPlanMode") {
      return {};
    }
    const toolInput = isRecord(preInput.tool_input) ? preInput.tool_input : {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: "Plan already approved in Eco. Completing deferred ExitPlanMode.",
        updatedInput: mergeExitPlanModeInjectedFields(toolInput, preInput),
      },
    };
  };
}

/** Parse `deferred_tool_use` for ExitPlanMode from an SDK result message (defer protocol payload). */
export function parseDeferredExitPlanModeResult(
  message: unknown,
): { toolUseId: string; request: SdkExitPlanModeRequest } | undefined {
  if (!isRecord(message) || message.type !== "result") {
    return undefined;
  }
  const deferred = message.deferred_tool_use;
  if (!isRecord(deferred) || deferred.name !== "ExitPlanMode") {
    return undefined;
  }
  const toolUseId = typeof deferred.id === "string" ? deferred.id.trim() : "";
  const input = isRecord(deferred.input) ? deferred.input : {};
  return { toolUseId, request: parseExitPlanModeInput(input) };
}

/**
 * Capture the deferred ExitPlanMode plan from the SDK result payload.
 * This is the official primary channel for defer-based integrations; the PreToolUse hook
 * capture covers the same tool call, so `state` dedupes by tool use id.
 */
export async function captureDeferredExitPlanModeFromResult(
  message: unknown,
  delegate: EcoHookContext["onExitPlanMode"],
  state: { capturedToolUseIds: Set<string> } | undefined,
  options: {
    searchRoots?: readonly (string | undefined)[];
    getPhaseTranscript?: () => string;
  } = {},
): Promise<boolean> {
  if (!delegate) {
    return false;
  }
  const deferred = parseDeferredExitPlanModeResult(message);
  if (!deferred) {
    return false;
  }
  const resolved = await resolveExitPlanModeSubmission(deferred.request, {
    searchRoots: options.searchRoots ?? [],
    ...(options.getPhaseTranscript ? { getPhaseTranscript: options.getPhaseTranscript } : {}),
  });
  if (!resolved.plan.trim()) {
    return false;
  }
  return delegateExitPlanModeCapture(delegate, state, { ...resolved, toolUseId: deferred.toolUseId });
}

function mergeExitPlanModeInjectedFields(
  toolInput: Record<string, unknown>,
  hookInput: PreToolUseHookInput,
): Record<string, unknown> {
  const merged = { ...toolInput };
  const hookRecord = hookInput as unknown as Record<string, unknown>;
  for (const key of [
    "plan",
    "planFilePath",
    "plan_file_path",
    "filePath",
    "file_path",
    "plan_filename",
    "plan_path",
    "allowedPrompts",
    "allowed_prompts",
  ]) {
    if (merged[key] === undefined && hookRecord[key] !== undefined) {
      merged[key] = hookRecord[key];
    }
  }
  return merged;
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

export function createNonEcoSubagentDenyPreToolHook(
  allowedAgentKeys: readonly string[] = [],
  allowedSdkBuiltinAgentKeys: readonly string[] = [],
): HookCallback {
  const allowed = new Set(allowedAgentKeys);
  const allowedSdkBuiltins = new Set([SDK_GENERAL_PURPOSE_AGENT_KEY, ...allowedSdkBuiltinAgentKeys]);
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
    if (allowedSdkBuiltins.has(rawType)) {
      return {};
    }
    const normalizedType = normalizeSdkSubagentType(rawType);
    if (normalizedType && isSubagentRole(normalizedType)) {
      return {};
    }
    const normalizedEcoKey = normalizedType ? `eco_${normalizedType}` : undefined;
    if (allowed.has(rawType) || (normalizedEcoKey && allowed.has(normalizedEcoKey))) {
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
    if (!isSubagentRole(subagentType) || isSubagentEnabled(resolved, subagentType)) {
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

export function createToolPermissionPreToolHook(
  policy?: EcoRuntimeToolPermissionPolicy,
  options: {
    workspacePath?: string;
    bashReviewMode?: BashReviewMode;
    resolveBashReviewMode?: () => BashReviewMode;
    onDecision?: (decision: EcoToolPermissionDecisionAudit) => void;
  } = {},
): HookCallback | undefined {
  if (!policy) {
    return undefined;
  }
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") {
      return {};
    }
    const preInput = input as PreToolUseHookInput;
    if (preInput.tool_name === "EnterPlanMode" || preInput.tool_name === "ExitPlanMode") {
      return {};
    }
    const actor = resolveToolPermissionActor(preInput);
    const entry = resolveToolPermissionEntry(policy, actor);
    if (!entry) {
      return recordToolPermissionDecision(
        preInput,
        actor,
        denyTool(preInput.tool_name, `No Eco tool policy is registered for agent ${actor}.`),
        options,
      );
    }
    if (matchesAnyToolPattern(preInput.tool_name, entry.disallowed)) {
      return recordToolPermissionDecision(
        preInput,
        actor,
        denyTool(preInput.tool_name, `Tool "${preInput.tool_name}" is disallowed for ${actor}.`),
        options,
      );
    }
    const structuredDecision = evaluateStructuredToolPolicy(preInput, entry, { ...options, actor });
    if (structuredDecision) {
      return recordToolPermissionDecision(preInput, actor, structuredDecision, options);
    }
    if (entry.allowed.length > 0 && !matchesAnyToolPattern(preInput.tool_name, entry.allowed)) {
      return recordToolPermissionDecision(
        preInput,
        actor,
        denyTool(preInput.tool_name, `Tool "${preInput.tool_name}" is not allowed for ${actor}.`),
        options,
      );
    }
    return {};
  };
}

function resolveToolPermissionActor(input: PreToolUseHookInput): "main" | string {
  if (typeof input.agent_id === "string" && input.agent_id.trim()) {
    return typeof input.agent_type === "string" && input.agent_type.trim()
      ? input.agent_type.trim()
      : input.agent_id.trim();
  }
  return "main";
}

function resolveToolPermissionEntry(
  policy: EcoRuntimeToolPermissionPolicy,
  actor: "main" | string,
): EcoRuntimeToolPermissionEntry | undefined {
  if (actor === "main") {
    return policy.main;
  }
  const directEntry = policy.agents[actor];
  if (directEntry) {
    return directEntry;
  }
  if (!actor.startsWith("eco_")) {
    const dynamicEntry = policy.agents[`eco_${actor}`];
    if (dynamicEntry) {
      return dynamicEntry;
    }
  }
  const normalizedRole = normalizeSdkSubagentType(actor);
  return normalizedRole ? policy.agents[`eco_${normalizedRole}`] : undefined;
}

/**
 * Delegation guidance appended to main-agent policy denials, so the orchestrator
 * immediately knows the sanctioned alternative instead of retrying denied tools.
 */
function mainAgentDelegationHint(actor: "main" | string | undefined): string {
  return actor === "main"
    ? " This is the active Eco profile policy for the main orchestrator, not a transient error. Delegate the work to an enabled subagent via the Agent tool instead of retrying."
    : "";
}

function evaluateStructuredToolPolicy(
  input: PreToolUseHookInput,
  entry: EcoRuntimeToolPermissionEntry,
  options: {
    workspacePath?: string;
    bashReviewMode?: BashReviewMode;
    resolveBashReviewMode?: () => BashReviewMode;
    actor?: "main" | string;
  },
): HookJSONOutput | undefined {
  if (input.tool_name === "Bash") {
    return evaluateBashToolPolicy(input, entry, options);
  }
  const filesystemDecision = evaluateFilesystemToolPolicy(input, entry, options);
  if (filesystemDecision) {
    return filesystemDecision;
  }
  return evaluateNetworkToolPolicy(input, entry);
}

function evaluateBashToolPolicy(
  input: PreToolUseHookInput,
  entry: EcoRuntimeToolPermissionEntry,
  options: {
    workspacePath?: string;
    bashReviewMode?: BashReviewMode;
    resolveBashReviewMode?: () => BashReviewMode;
    actor?: "main" | string;
  },
): HookJSONOutput | undefined {
  const bash = entry.bash;
  if (!bash?.enabled) {
    return denyTool(
      "Bash",
      `Bash is disabled for this Eco agent.${mainAgentDelegationHint(options.actor)}`,
    );
  }
  const command = readBashCommand(input.tool_input);
  const mode = options.resolveBashReviewMode?.() ?? options.bashReviewMode ?? "always";
  if (!command) {
    if (mode === "allow_all") {
      return undefined;
    }
    return askTool("Bash", "Bash command could not be evaluated and requires approval.");
  }
  const workspacePath = options.workspacePath?.trim() || input.cwd;
  const decision = evaluateBashPolicy({
    command,
    cwd: input.cwd,
    workspacePath,
    mode,
    agentBash: {
      ...(bash.commandAllowlist ? { commandAllowlist: bash.commandAllowlist } : {}),
      ...(bash.commandDenylist ? { commandDenylist: bash.commandDenylist } : {}),
    },
  });
  if (decision.action === "deny") {
    return denyTool("Bash", decision.reason);
  }
  if (decision.action === "ask") {
    return askTool("Bash", decision.reason);
  }
  return undefined;
}

function evaluateFilesystemToolPolicy(
  input: PreToolUseHookInput,
  entry: EcoRuntimeToolPermissionEntry,
  options: { workspacePath?: string; actor?: "main" | string },
): HookJSONOutput | undefined {
  const filesystem = entry.filesystem;
  if (!filesystem) {
    return undefined;
  }
  const isReadTool = READ_FILESYSTEM_TOOLS.has(input.tool_name);
  const isWriteTool = WRITE_FILESYSTEM_TOOLS.has(input.tool_name);
  if (!isReadTool && !isWriteTool) {
    return undefined;
  }
  if (isReadTool && filesystem.read === "none") {
    return denyTool(input.tool_name, "Filesystem reads are disabled for this Eco agent.");
  }
  if (isWriteTool && filesystem.write === "none") {
    return denyTool(
      input.tool_name,
      `Filesystem writes are disabled for this Eco agent.${mainAgentDelegationHint(options.actor)}`,
    );
  }
  const filePath = readFilesystemPath(input.tool_input);
  if (!filePath) {
    return undefined;
  }
  const workspacePath = options.workspacePath?.trim();
  if (!workspacePath) {
    return undefined;
  }
  const absolutePath = resolvePolicyPath(filePath, input.cwd);
  const insideScope = isPathInsidePolicyScope(absolutePath, workspacePath);
  if (isReadTool && filesystem.read !== "none" && !insideScope) {
    return denyTool(input.tool_name, "Filesystem read path is outside this Eco agent workspace scope.");
  }
  if (
    isWriteTool &&
    filesystem.write === "workspace" &&
    !insideScope
  ) {
    return denyTool(input.tool_name, "Filesystem write path is outside this Eco agent workspace scope.");
  }
  return undefined;
}

function evaluateNetworkToolPolicy(
  input: PreToolUseHookInput,
  entry: EcoRuntimeToolPermissionEntry,
): HookJSONOutput | undefined {
  if (!entry.network) {
    return undefined;
  }
  if (input.tool_name === "WebSearch" && !entry.network.webSearch) {
    return denyTool("WebSearch", "WebSearch is disabled for this Eco agent.");
  }
  if (input.tool_name === "WebFetch" && !entry.network.webFetch) {
    return denyTool("WebFetch", "WebFetch is disabled for this Eco agent.");
  }
  return undefined;
}

function resolvePolicyPath(filePath: string, cwd: string): string {
  const normalizedPath = normalizePolicyPathSeparators(filePath);
  if (isAbsolutePolicyPath(normalizedPath)) {
    return normalizePolicyPath(normalizedPath);
  }
  return normalizePolicyPath(`${cwd}/${normalizedPath}`);
}

function isPathInsidePolicyScope(candidatePath: string, parentPath: string): boolean {
  const candidate = normalizePolicyPath(candidatePath);
  const parent = normalizePolicyPath(parentPath);
  if (candidate === parent) {
    return true;
  }
  const parentPrefix = parent.endsWith("/") ? parent : `${parent}/`;
  return candidate.startsWith(parentPrefix);
}

function normalizePolicyPath(value: string): string {
  const normalized = normalizePolicyPathSeparators(value.trim());
  const driveMatch = /^([A-Za-z]:)(?:\/(.*))?$/.exec(normalized);
  const prefix = driveMatch ? driveMatch[1] : normalized.startsWith("/") ? "/" : "";
  const body = driveMatch ? (driveMatch[2] ?? "") : normalized.replace(/^\/+/, "");
  const parts: string[] = [];
  for (const part of body.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (prefix === "/") {
    return `/${parts.join("/")}`.replace(/\/+$/u, "") || "/";
  }
  if (prefix) {
    return `${prefix}/${parts.join("/")}`.replace(/\/+$/u, "");
  }
  return parts.join("/");
}

function normalizePolicyPathSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function isAbsolutePolicyPath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:\//.test(value);
}

function readBashCommand(input: unknown): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  for (const key of ["command", "bash_command", "full_command"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readFilesystemPath(input: unknown): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  for (const key of ["file_path", "filePath", "path", "notebook_path", "notebookPath"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function matchesAnyCommandPattern(command: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesCommandPattern(command, pattern));
}

function matchesCommandPattern(command: string, pattern: string): boolean {
  const trimmedPattern = pattern.trim();
  if (!trimmedPattern) {
    return false;
  }
  if (trimmedPattern.includes("*")) {
    return matchesToolPattern(command, trimmedPattern);
  }
  return command === trimmedPattern || command.startsWith(`${trimmedPattern} `);
}

function askTool(toolName: string, reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: reason || `Tool "${toolName}" requires approval by Eco policy.`,
    },
  };
}

function recordToolPermissionDecision(
  input: PreToolUseHookInput,
  actor: string,
  output: HookJSONOutput,
  options: { onDecision?: (decision: EcoToolPermissionDecisionAudit) => void },
): HookJSONOutput {
  const hookOutput = "hookSpecificOutput" in output ? output.hookSpecificOutput : undefined;
  if (hookOutput?.hookEventName !== "PreToolUse" || hookOutput.permissionDecision !== "deny") {
    return output;
  }
  options.onDecision?.({
    permissionDecision: "deny",
    toolName: input.tool_name,
    toolUseId: input.tool_use_id,
    reason: hookOutput.permissionDecisionReason || `Tool "${input.tool_name}" is denied by Eco policy.`,
    actor,
    ...(typeof input.session_id === "string" && { sessionId: input.session_id }),
    ...(typeof input.agent_id === "string" && { agentId: input.agent_id }),
    ...(typeof input.agent_type === "string" && { agentType: input.agent_type }),
    cwd: input.cwd,
  });
  return output;
}

function denyTool(toolName: string, reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason || `Tool "${toolName}" is denied by Eco policy.`,
    },
  };
}

function matchesAnyToolPattern(toolName: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesToolPattern(toolName, pattern));
}

function matchesToolPattern(toolName: string, pattern: string): boolean {
  if (pattern === "*" || pattern === toolName) {
    return true;
  }
  if (!pattern.includes("*")) {
    return false;
  }
  const parts = pattern.split("*");
  let offset = 0;
  for (const [index, part] of parts.entries()) {
    if (!part) {
      continue;
    }
    const found = toolName.indexOf(part, offset);
    if (found < 0) {
      return false;
    }
    if (index === 0 && found !== 0) {
      return false;
    }
    offset = found + part.length;
  }
  const last = parts[parts.length - 1] ?? "";
  return !last || toolName.endsWith(last);
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
      const rawType = readAgentSubagentType(toolInput);
      const role = normalizeSdkBuiltinOrEcoAgentRole(rawType);
      onTaskToolUse(toolUseID, role ? { role } : undefined);
    }
    return {};
  };
}

function normalizeSdkBuiltinOrEcoAgentRole(rawType: string | undefined): RuntimeAgentRole | undefined {
  if (rawType === SDK_GENERAL_PURPOSE_AGENT_KEY || rawType === SDK_PLAN_AGENT_KEY) {
    return rawType;
  }
  return normalizeSdkSubagentType(rawType ?? "");
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
  const exitPlanHookOptions = {
    ...(ctx.workspacePath ? { workspacePath: ctx.workspacePath } : {}),
    ...(ctx.getPhaseTranscript ? { getPhaseTranscript: ctx.getPhaseTranscript } : {}),
  };
  pushHook(
    hooks,
    "PreToolUse",
    createExitPlanModePreToolHook(ctx.onExitPlanMode, ctx.exitPlanCaptureState, exitPlanHookOptions),
    "ExitPlanMode",
  );
  pushHook(
    hooks,
    "PermissionRequest",
    createExitPlanModePermissionRequestHook(ctx.onExitPlanMode, ctx.exitPlanCaptureState, exitPlanHookOptions),
    "ExitPlanMode",
  );
  if (!ctx.onExitPlanMode && ctx.approveDeferredExitPlanMode) {
    pushHook(hooks, "PreToolUse", createExitPlanModeResumeApproveHook(), "ExitPlanMode");
  }
  pushHook(hooks, "PreToolUse", createNormalizeSubagentPreToolHook(), "Agent|Task");
  pushHook(
    hooks,
    "PreToolUse",
    createNonEcoSubagentDenyPreToolHook(ctx.allowedAgentKeys, ctx.allowedSdkBuiltinAgentKeys),
    "Agent|Task",
  );
  pushHook(hooks, "PreToolUse", createDisabledSubagentPreToolHook(availability), "Agent|Task");
  pushHook(
    hooks,
    "PreToolUse",
    createToolPermissionPreToolHook(ctx.toolPermissions, {
      ...(ctx.workspacePath && { workspacePath: ctx.workspacePath }),
      bashReviewMode: ctx.bashReviewMode ?? "always",
      ...(ctx.resolveBashReviewMode && { resolveBashReviewMode: ctx.resolveBashReviewMode }),
      ...(ctx.onToolPermissionDecision && { onDecision: ctx.onToolPermissionDecision }),
    }),
  );
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
