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
import type { AgentRole, RuntimeAgentRole } from "../../shared/src";
import {
  isSubagentEnabled,
  isSubagentRole,
  normalizeSubagentAvailability,
  type SubagentAvailability,
} from "./subagent-availability";
import type { EcoRuntimeToolPermissionEntry, EcoRuntimeToolPermissionPolicy } from "./agent-orchestration.js";

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
  taskTracker?: EcoTaskTrackerHooks;
  subagentSessions?: EcoSubagentSessionHooks;
  subagentAttribution?: EcoSubagentAttributionHooks;
  onNotification?: (input: { message: string; title?: string; notificationType: string }) => void;
  onPreCompact?: (input: EcoPreCompactHookInput) => Promise<void>;
  getStopTodoStatus?: () => "completed" | "blocked" | "cancelled";
  subagentAvailability?: SubagentAvailability;
  allowedAgentKeys?: string[];
  toolPermissions?: EcoRuntimeToolPermissionPolicy;
  workspacePath?: string;
  onToolPermissionDecision?: (decision: EcoToolPermissionDecisionAudit) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const READ_FILESYSTEM_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead"]);
const WRITE_FILESYSTEM_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const PACKAGE_INSTALL_COMMANDS = new Set(["npm", "pnpm", "yarn", "bun"]);
const PACKAGE_INSTALL_ARGS = new Set(["install", "i", "add", "remove"]);
const ALWAYS_ASK_COMMANDS = new Set(["docker", "sudo"]);

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
    const structuredDecision = evaluateStructuredToolPolicy(preInput, entry, options);
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

function evaluateStructuredToolPolicy(
  input: PreToolUseHookInput,
  entry: EcoRuntimeToolPermissionEntry,
  options: { workspacePath?: string },
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
  options: { workspacePath?: string },
): HookJSONOutput | undefined {
  const bash = entry.bash;
  if (!bash?.enabled) {
    return denyTool("Bash", "Bash is disabled for this Eco agent.");
  }
  const command = readBashCommand(input.tool_input);
  if (command) {
    if (matchesAnyCommandPattern(command, bash.commandDenylist ?? [])) {
      return denyTool("Bash", "Bash command is denied by this Eco agent command denylist.");
    }
    if (
      (bash.commandAllowlist?.length ?? 0) > 0 &&
      !matchesAnyCommandPattern(command, bash.commandAllowlist ?? [])
    ) {
      return denyTool("Bash", "Bash command is outside this Eco agent command allowlist.");
    }
  }
  if (bash.approval === "always") {
    return askTool("Bash", "Bash requires approval for this Eco agent.");
  }
  if (bash.approval === "risky") {
    if (!command) {
      return askTool("Bash", "Bash command could not be evaluated and requires approval.");
    }
    const workspacePath = options.workspacePath?.trim() || input.cwd;
    const decision = evaluateShellCommandTextPolicy({
      command,
      cwd: input.cwd,
      workspacePath,
    });
    if (decision.action === "deny") {
      return denyTool("Bash", decision.reason);
    }
    if (decision.action === "ask") {
      return askTool("Bash", decision.reason);
    }
  }
  return undefined;
}

function evaluateFilesystemToolPolicy(
  input: PreToolUseHookInput,
  entry: EcoRuntimeToolPermissionEntry,
  options: { workspacePath?: string },
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
    return denyTool(input.tool_name, "Filesystem writes are disabled for this Eco agent.");
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
  if (isReadTool && filesystem.read !== "none" && !isPathInsidePolicyScope(absolutePath, workspacePath)) {
    return denyTool(input.tool_name, "Filesystem read path is outside this Eco agent workspace scope.");
  }
  if (
    isWriteTool &&
    filesystem.write === "workspace" &&
    !isPathInsidePolicyScope(absolutePath, workspacePath)
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

type EcoPolicyDecision = {
  action: "allow" | "ask" | "deny";
  riskRank: number;
  reason: string;
};

function evaluateShellCommandTextPolicy(input: {
  command: string;
  cwd: string;
  workspacePath: string;
}): EcoPolicyDecision {
  if (!isPathInsidePolicyScope(input.cwd, input.workspacePath)) {
    return { action: "deny", riskRank: 4, reason: "Command cwd is outside the workspace" };
  }
  const decisions = input.command
    .split(/\s*(?:&&|\|\||;|\|)\s*/g)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(evaluateShellSegmentPolicy);

  if (decisions.length === 0) {
    return { action: "deny", riskRank: 3, reason: "Empty command is not allowed" };
  }
  const denied = decisions.find((decision) => decision.action === "deny");
  if (denied) {
    return denied;
  }
  const asks = decisions.filter((decision) => decision.action === "ask");
  if (asks.length > 0) {
    return asks.reduce((strictest, decision) =>
      decision.riskRank > strictest.riskRank ? decision : strictest,
    );
  }
  return { action: "allow", riskRank: 1, reason: "Command is allowed by default policy" };
}

function evaluateShellSegmentPolicy(segment: string): EcoPolicyDecision {
  const [program, ...args] = tokenizeShellSegment(segment);
  if (!program) {
    return { action: "deny", riskRank: 3, reason: "Empty command is not allowed" };
  }
  if (program === "rm") {
    return { action: "ask", riskRank: 4, reason: "File deletion requires approval" };
  }
  if (program === "git" && args[0] === "reset") {
    return { action: "ask", riskRank: 4, reason: "git reset requires approval" };
  }
  if (program === "git" && args[0] === "clean") {
    return { action: "ask", riskRank: 3, reason: "git clean can delete files" };
  }
  if (PACKAGE_INSTALL_COMMANDS.has(program) && args.some((arg) => PACKAGE_INSTALL_ARGS.has(arg))) {
    return { action: "ask", riskRank: 2, reason: "Dependency changes require approval" };
  }
  if (ALWAYS_ASK_COMMANDS.has(program)) {
    return { action: "ask", riskRank: 3, reason: `${program} requires approval` };
  }
  return { action: "allow", riskRank: 1, reason: "Command is allowed by default policy" };
}

function tokenizeShellSegment(segment: string): string[] {
  return segment
    .replace(/^\s*(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*/, "")
    .split(/\s+/g)
    .filter(Boolean);
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
  pushHook(
    hooks,
    "PreToolUse",
    createToolPermissionPreToolHook(ctx.toolPermissions, {
      ...(ctx.workspacePath && { workspacePath: ctx.workspacePath }),
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
