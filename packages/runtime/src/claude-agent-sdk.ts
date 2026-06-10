import type { ResolvedModelRoute } from "../../model-router/src";
import type { SessionStore } from "../../persistence/src/session-store.js";
import {
  type AgentEvent,
  type AgentEventType,
  type AgentRole,
  createAgentEvent,
  type PlanReadyPayload,
  type RuntimeAgentRole,
} from "../../shared/src";
import { formatSubagentMissionMessage } from "./agent-mission";
import {
  buildMainAgentSystemPrompt,
  buildBuiltinPlanToolPermissionEntry,
  buildToolPermissionPolicyFromProfile,
  createAgentDefinitionsFromProfile,
  resolveMainAgentAllowedTools,
  resolveMainAgentHandsOnCapability,
  SDK_DELEGATION_SUPPORT_TOOL_NAMES,
  SDK_FILESYSTEM_READ_TOOL_NAMES,
  SDK_FILESYSTEM_WRITE_TOOL_NAMES,
  SDK_SKILL_TOOL_NAME,
  SDK_TASK_PROGRESS_TOOL_NAMES,
} from "./agent-orchestration.js";
import { expandAssistantMessageContent } from "./anthropic-content-normalize.js";
import {
  buildEcoSdkHooks,
  captureDeferredExitPlanModeFromResult,
  type EcoHookContext,
  type EcoToolPermissionDecisionAudit,
} from "./eco-sdk-hooks.js";
import type {
  AgentRuntimeDriver,
  AgentRuntimeRunInput,
  EcoPlanningContext,
  EcoSdkResumeOptions,
  EcoSdkSessionOptions,
} from "./index";
import { buildBuiltinOtelEnv, type EcoBuiltinOtelOptions } from "./otel-env";
import {
  applySubagentUsageAttribution,
  createSdkStreamContext,
  mapStreamEventToEvents,
  type SdkStreamContext,
  slimStreamEventMessage,
} from "./sdk-stream-events.js";
import { resolveSkillDisplayName } from "./skill-display";
import { extractPlanningDeliverables, findPlanSectionStart } from "./phase-deliverable.js";
import { toWorkspaceRelativePlanFile } from "./plan-path.js";
import { mergeStreamText } from "./stream-text";
import { formatResumableSubagentsAppend, normalizeSdkSubagentType } from "./subagent-resume.js";

export type { EcoHookContext, EcoPreCompactHookInput } from "./eco-sdk-hooks.js";

import { buildAutonomousOrchestratorAppend } from "./prompts/autonomous.js";
import { buildMainAgentHandsOnBoundaryAppend } from "./prompts/subagent-pipeline.js";
import {
  buildAnalyzePhasePrompt,
  buildAutonomousPlanContinuationPrompt,
  buildExecuteBuildSwitchAppend,
  buildExecutePhasePrompt,
  buildExecutePhaseSystemAppend,
  buildExecuteResumePrompt,
  buildExecutionPromptWithFollowUp,
  buildPlanningContinuationPrompt,
  buildPlanningPhasePrompt,
  buildPlanningPhaseSystemAppend,
  buildPlanPhasePrompt,
  buildQuestionAnswerPrompt,
  buildQuestionAnswerSystemAppend,
  ecoBasePromptAppend,
  executePhaseSystemAppend,
  executionArchitectDescription,
  executionArchitectPrompt,
  executionCoderDescription,
  executionCoderPrompt,
  executionTesterDescription,
  executionTesterPrompt,
  exploreAgentDescription,
  exploreAgentPrompt,
  planningArchitectDescription,
  planningArchitectPrompt,
  planningPhaseSystemAppend,
  questionAnswerSystemAppend,
  reviewerAgentPrompt,
} from "./prompts/index.js";
import {
  defaultSubagentAvailability,
  type EcoOrchestrationMode,
  ecoSubagentKeyForRole,
  filterAgentDefinitions,
  isSubagentRole,
  normalizeSubagentAvailability,
  SDK_GENERAL_PURPOSE_AGENT_KEY,
  SDK_PLAN_AGENT_KEY,
  SUBAGENT_ROLES,
  type SubagentAvailability,
  type SubagentRole,
  sdkBuiltinSubagentDenyRules,
} from "./subagent-availability.js";
import type { ThinkingEffort } from "./thinking-options.js";
import { applyThinkingToProcessEnv, applyThinkingToQueryOptions } from "./thinking-options.js";

export { type EcoOrchestrationMode, isSubagentRole, SUBAGENT_ROLES, type SubagentRole };

type SdkQuery = (input: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<unknown> & {
  close?: () => void;
  getContextUsage?: () => Promise<Record<string, unknown>>;
  rewindFiles?: (userMessageId: string, options?: { dryRun?: boolean }) => Promise<unknown>;
};

interface SdkSessionMutationOptions {
  dir?: string;
  sessionStore?: SessionStore;
}

interface SdkSessionReadOptions extends SdkSessionMutationOptions {
  limit?: number;
  offset?: number;
  includeSystemMessages?: boolean;
}

interface SdkSessionMessage {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
}

export interface ClaudeAgentSdkModule {
  query: SdkQuery;
  deleteSession?: (sessionId: string, options?: SdkSessionMutationOptions) => Promise<void>;
  getSessionMessages?: (sessionId: string, options?: SdkSessionReadOptions) => Promise<SdkSessionMessage[]>;
}

const networkAllowedTools = ["WebSearch", "WebFetch"] as const;
const defaultAllowedTools = [
  "Agent",
  ...SDK_DELEGATION_SUPPORT_TOOL_NAMES,
  SDK_SKILL_TOOL_NAME,
  ...SDK_TASK_PROGRESS_TOOL_NAMES,
  ...SDK_FILESYSTEM_READ_TOOL_NAMES,
  ...SDK_FILESYSTEM_WRITE_TOOL_NAMES,
  "Bash",
  ...networkAllowedTools,
] as const;
const executionAllowedTools = [
  "Agent",
  ...SDK_DELEGATION_SUPPORT_TOOL_NAMES,
  SDK_SKILL_TOOL_NAME,
  ...SDK_TASK_PROGRESS_TOOL_NAMES,
  ...SDK_FILESYSTEM_READ_TOOL_NAMES,
  ...SDK_FILESYSTEM_WRITE_TOOL_NAMES,
  "Bash",
] as const;
const planningAllowedTools = [
  "Agent",
  ...SDK_DELEGATION_SUPPORT_TOOL_NAMES,
  SDK_SKILL_TOOL_NAME,
  ...SDK_FILESYSTEM_READ_TOOL_NAMES,
  ...networkAllowedTools,
  "AskUserQuestion",
] as const;
/** SDK `disallowedTools` removes write tools from the model context during planning. */
const planningDisallowedSdkTools = [
  ...SDK_FILESYSTEM_WRITE_TOOL_NAMES,
] as const;
const questionAllowedTools = [
  "Agent",
  ...SDK_DELEGATION_SUPPORT_TOOL_NAMES,
  SDK_SKILL_TOOL_NAME,
  ...SDK_FILESYSTEM_READ_TOOL_NAMES,
  ...networkAllowedTools,
] as const;
const exploreSubagentTools = ["Read", "Glob", "Grep"] as const;
const readOnlySubagentTools = [...SDK_FILESYSTEM_READ_TOOL_NAMES, ...networkAllowedTools] as const;
const executionReadOnlySubagentTools = [...SDK_FILESYSTEM_READ_TOOL_NAMES] as const;
const readOnlySubagentBashTools = [
  ...SDK_FILESYSTEM_READ_TOOL_NAMES,
  "Bash",
  ...networkAllowedTools,
] as const;
const executionReadOnlySubagentBashTools = [...SDK_FILESYSTEM_READ_TOOL_NAMES, "Bash"] as const;
const executionCoderTools = [
  ...SDK_FILESYSTEM_READ_TOOL_NAMES,
  ...SDK_FILESYSTEM_WRITE_TOOL_NAMES,
  "Bash",
] as const;
const autonomousAllowedTools = [...defaultAllowedTools, "AskUserQuestion"] as const;
const universalEcoBasePromptAppend = [
  "You are running inside Eco, a configurable agent command center.",
  "Follow the active Eco orchestration profile and delegate only to the listed Eco subagents.",
  "Use tools only when they are allowed for the active role and materially help the user's task.",
].join("\n");
/** Read-only phases: auto-approve tools in allowedTools without edit prompts. */
const readOnlyPermissionMode = "dontAsk" as const;
const defaultSettingSources = ["user", "project"] as const;

function usesUniversalAgentProfile(input: AgentRuntimeRunInput): boolean {
  return Boolean(input.agentRegistry && input.agentRegistry.profile.preset !== "coding");
}

/** Universal profiles use custom rosters, so the hands-on boundary points at the roster instead of eco_* keys. */
const universalDelegateOptions = {
  delegateTarget: "an implementation-capable agent from the active profile roster (via Agent(...))",
} as const;

function buildUniversalPhaseAppend(phase: "answer" | "plan" | "execute" | "autonomous"): string {
  const phaseLine =
    phase === "answer"
      ? "Current phase: answer the user directly."
      : phase === "plan"
        ? "Current phase: understand the request and produce a decision-ready plan when planning is required."
        : phase === "execute"
          ? "Current phase: carry out the approved or current task according to the active profile."
          : "Current phase: handle the task directly, ask a clarifying question when needed, or delegate.";
  return [
    "Eco universal orchestration.",
    phaseLine,
    `Use Agent(...) with Eco agent keys shown in the active profile roster, or Agent(${SDK_GENERAL_PURPOSE_AGENT_KEY}) for complex multi-step work that needs both exploration and action.`,
    "Do not use other SDK built-in agents or the SDK Workflow tool.",
  ].join("\n");
}

function buildUniversalQuestionPrompt(userPrompt: string): string {
  return [
    "User question:",
    userPrompt.trim(),
    "",
    "Answer directly. Use available Eco subagents only when they improve the answer.",
  ].join("\n");
}

function buildUniversalPlanningPrompt(userPrompt: string): string {
  return [
    "User request:",
    userPrompt.trim(),
    "",
    "You are in Eco planning mode.",
    "Use available Eco subagents when they improve the analysis.",
    "If the next actions are clear, present a decision-complete Markdown plan and call `ExitPlanMode`.",
    "Do not use Write/Edit/MultiEdit to create a plan file; Claude Code persists the plan internally and injects it into ExitPlanMode hooks.",
    "Do not execute the plan in this phase.",
  ].join("\n");
}

function buildUniversalPlanningContinuationPrompt(userPrompt: string): string {
  return [
    "User follow-up (same Eco planning session):",
    userPrompt.trim(),
    "",
    "Update the analysis and plan as needed.",
    "When the spec is decision-complete, present a complete replacement Markdown plan and call `ExitPlanMode` rather than producing a delta.",
  ].join("\n");
}

function buildUniversalExecutionPromptWithFollowUp(
  planning: {
    userPrompt: string;
    analysis: string;
    plan: string;
    planUserEdited?: boolean;
    approvedPlanFile?: string;
    resumableSubagents?: readonly { role: string; agentId: string }[];
  },
  followUp: string,
  options: { isResume: boolean; includePlanOnResume?: boolean },
): string {
  const includePlanText = !options.isResume || options.includePlanOnResume === true;
  const lines = includePlanText
    ? [
        "Continue from the approved plan.",
        "",
        "Original user request:",
        planning.userPrompt.trim() || "(not captured)",
        "",
        "Approved analysis:",
        planning.analysis.trim() || "(no analysis captured)",
        "",
        "Approved plan:",
        planning.plan.trim() || "(no plan captured)",
      ]
    : ["Continue with the approved plan already submitted in this Eco session."];

  if (planning.planUserEdited) {
    lines.push(
      "",
      "<system-reminder>",
      "The user edited this plan in Eco before approval. Treat the approved plan as authoritative over earlier drafts.",
      "</system-reminder>",
    );
  }

  if (planning.approvedPlanFile?.trim()) {
    lines.push("", `On-disk copy (workspace root): ${planning.approvedPlanFile.trim()}`);
  }

  const trimmed = followUp.trim();
  if (trimmed && trimmed !== planning.userPrompt.trim()) {
    lines.push("", "Latest user message:", trimmed);
  }

  lines.push("", "Use the active Eco orchestration profile and its listed subagents as needed.");
  lines.push(formatResumableSubagentsAppend(planning.resumableSubagents ?? []));
  return lines.join("\n");
}

function buildUniversalPlanContinuationPrompt(input: {
  userPrompt: string;
  analysis: string;
  plan: string;
  planUserEdited?: boolean;
  followUp?: string;
}): string {
  const lines = [
    "<system-reminder>",
    "The user approved your submitted plan. Continue in the same Eco session using the active profile.",
    "</system-reminder>",
    "",
    input.planUserEdited
      ? "The user edited the plan in Eco before approval. Treat the approved plan below as authoritative."
      : "Use the approved plan already submitted in this session.",
  ];
  if (input.planUserEdited) {
    lines.push(
      "",
      "Original user request:",
      input.userPrompt.trim(),
      "",
      "Approved analysis:",
      input.analysis.trim() || "(none)",
      "",
      "Approved plan:",
      input.plan.trim() || "(none)",
    );
  }
  const followUp = input.followUp?.trim();
  if (followUp && followUp !== input.userPrompt.trim()) {
    lines.push("", "Latest user message:", followUp);
  }
  return lines.join("\n");
}

export function mergeAllowedTools(base: string[], session?: EcoSdkSessionOptions): string[] {
  const merged = new Set(base);
  for (const tool of session?.mcpAllowedTools ?? []) {
    merged.add(tool);
  }
  return [...merged];
}

export function resolveSdkSessionOptions(session?: EcoSdkSessionOptions): {
  settingSources: EcoSdkSessionOptions["settingSources"];
  skills: EcoSdkSessionOptions["skills"];
  mcpServers: Record<string, unknown>;
} {
  const plannerSkills = resolveAgentSkills("planner", session?.agentSkills, session?.skills);
  return {
    settingSources: session?.settingSources ?? [...defaultSettingSources],
    skills: plannerSkills.length > 0 ? plannerSkills : undefined,
    mcpServers: session?.mcpServers ?? {},
  };
}

export function resolveSubagentAvailabilityFromSession(session?: EcoSdkSessionOptions): SubagentAvailability {
  return normalizeSubagentAvailability(session?.enabledSubagents);
}

export function resolveAgentSkills(
  role: RuntimeAgentRole,
  agentSkills?: Partial<Record<RuntimeAgentRole, string[]>>,
  sessionSkills?: string[],
): string[] {
  const fromRole = readAgentSkillAssignment(agentSkills, role);
  if (fromRole && fromRole.length > 0) {
    return [...fromRole];
  }
  if (role === "planner" && sessionSkills && sessionSkills.length > 0) {
    return [...sessionSkills];
  }
  return [];
}

function agentDefinitionToolFields(
  role: RuntimeAgentRole,
  tools: readonly string[],
  agentSkills?: Partial<Record<RuntimeAgentRole, string[]>>,
): Record<string, unknown> {
  const skills = resolveAgentSkills(role, agentSkills);
  return {
    tools: skills.length > 0 ? [...tools, SDK_SKILL_TOOL_NAME] : [...tools],
    ...(skills.length > 0 ? { skills } : {}),
  };
}

function readAgentSkillAssignment(
  agentSkills: Partial<Record<RuntimeAgentRole, string[]>> | undefined,
  role: RuntimeAgentRole,
): string[] | undefined {
  if (!agentSkills) {
    return undefined;
  }
  for (const key of agentSkillLookupKeys(role)) {
    const skills = agentSkills[key];
    if (skills && skills.length > 0) {
      return skills;
    }
  }
  return undefined;
}

function agentSkillLookupKeys(role: RuntimeAgentRole): string[] {
  const trimmed = role.trim();
  if (!trimmed) {
    return [];
  }
  const unprefixed = trimmed.startsWith("eco_") ? trimmed.slice(4) : trimmed;
  const prefixed = trimmed.startsWith("eco_") ? trimmed : `eco_${trimmed}`;
  return [...new Set([trimmed, unprefixed, prefixed])];
}

export type EcoRunPhase = "analyze" | "plan" | "execute" | "answer";

export interface ClaudeAgentSdkDriverOptions {
  apiKey: string;
  baseUrl: string;
  /** Default: autonomous (single session, agent picks subagents). Use manual for plan mode. */
  orchestration?: EcoOrchestrationMode;
  /**
   * When true, move cwd/git/platform context out of the cached system prompt prefix
   * so identical append text can share prompt cache across worktrees.
   */
  excludeDynamicSections?: boolean;
  /** When set, SDK CLI exports OTel to this local endpoint (eco-coding ingests for UI/logs). */
  otel?: EcoBuiltinOtelOptions;
  loadSdk?: () => Promise<ClaudeAgentSdkModule>;
  /** SDK callback hooks context (AskUserQuestion, reviewer scope, task tracking, notifications). */
  hookContext?: EcoHookContext;
  /** SDK-native tool permission callback. Desktop uses this for blocking Bash confirmation. */
  toolPermissionHandler?: (request: SdkToolPermissionRequest) => Promise<SdkToolPermissionDecision>;
  /** Mirror SDK session transcripts to external storage (mutually exclusive with file checkpointing). */
  sessionStore?: SessionStore;
  /** Optional probe logging for `getContextUsage()` (desktop sets from ECO_CONTEXT_SNAPSHOT_LOG). */
  onContextProbe?: (phase: string, detail: Record<string, unknown>) => void;
}

export interface SdkToolPermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string;
  agentId?: string;
  agentType?: string;
  cwd?: string;
  blockedPath?: string;
  decisionReason?: string;
  signal: AbortSignal;
}

export type SdkToolPermissionDecision =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string; interrupt?: boolean };

export async function deleteClaudeAgentSdkSession(input: {
  sessionId: string;
  dir?: string;
  sessionStore?: SessionStore;
  loadSdk?: () => Promise<ClaudeAgentSdkModule>;
}): Promise<void> {
  const sessionId = input.sessionId.trim();
  if (!sessionId) {
    return;
  }

  const sdk = input.loadSdk
    ? await input.loadSdk()
    : ((await import("@anthropic-ai/claude-agent-sdk")) as ClaudeAgentSdkModule);
  if (typeof sdk.deleteSession !== "function") {
    throw new Error("SDK deleteSession is not available. Update @anthropic-ai/claude-agent-sdk.");
  }

  const options: SdkSessionMutationOptions = {};
  if (input.dir?.trim()) {
    options.dir = input.dir.trim();
  }
  if (input.sessionStore) {
    options.sessionStore = input.sessionStore;
  }

  await sdk.deleteSession(sessionId, Object.keys(options).length > 0 ? options : undefined);
}

export async function resolveResumeSessionAtBeforeUserMessage(input: {
  sessionId: string;
  userMessageId: string;
  dir?: string;
  sessionStore?: SessionStore;
  loadSdk?: () => Promise<ClaudeAgentSdkModule>;
}): Promise<string | undefined> {
  const sessionId = input.sessionId.trim();
  const userMessageId = input.userMessageId.trim();
  if (!sessionId || !userMessageId) {
    throw new Error("SDK session id and user message id are required.");
  }

  const sdk = input.loadSdk
    ? await input.loadSdk()
    : ((await import("@anthropic-ai/claude-agent-sdk")) as ClaudeAgentSdkModule);
  if (typeof sdk.getSessionMessages !== "function") {
    throw new Error("SDK getSessionMessages is not available. Update @anthropic-ai/claude-agent-sdk.");
  }

  const options: SdkSessionReadOptions = { includeSystemMessages: false };
  if (input.dir?.trim()) {
    options.dir = input.dir.trim();
  }
  if (input.sessionStore) {
    options.sessionStore = input.sessionStore;
  }

  const messages = await sdk.getSessionMessages(sessionId, options);
  const targetIndex = messages.findIndex(
    (message) => message.uuid === userMessageId && message.type === "user",
  );
  if (targetIndex < 0) {
    throw new Error("找不到该节点对应的 SDK user message，无法安全回滚对话。");
  }

  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.uuid && candidate.type === "assistant") {
      return candidate.uuid;
    }
  }

  return undefined;
}

interface FinalizePlanPayload {
  analysis: string;
  plan: string;
  planFilePath?: string;
}

function resolvePlanningFinalizedPlanFromTranscript(
  transcript: string,
): FinalizePlanPayload | undefined {
  // Only an explicit plan section counts; arbitrary assistant text is not a plan.
  if (findPlanSectionStart(transcript.trim()) < 0) {
    return undefined;
  }
  const deliverables = extractPlanningDeliverables(transcript);
  if (!deliverables.plan.trim()) {
    return undefined;
  }
  return {
    analysis:
      deliverables.analysis.trim() ||
      "Plan captured from the planning session transcript after ExitPlanMode hooks had no SDK injection.",
    plan: deliverables.plan,
  };
}

function buildExitPlanModeAnalysis(submission: { planFilePath?: string }): string {
  return [
    "Claude official Plan Mode submitted this plan via ExitPlanMode.",
    submission.planFilePath ? `Plan file: ${submission.planFilePath}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export class ClaudeAgentSdkDriver implements AgentRuntimeDriver {
  constructor(private readonly options: ClaudeAgentSdkDriverOptions) {}

  async *run(input: AgentRuntimeRunInput): AsyncIterable<AgentEvent> {
    if (this.options.orchestration === "autonomous") {
      yield* this.runAutonomous(input);
      return;
    }

    yield* this.runPlanning(input);
  }

  async *runExecution(input: AgentRuntimeRunInput, planning: EcoPlanningContext): AsyncIterable<AgentEvent> {
    const universalProfile = usesUniversalAgentProfile(input);
    const availability = resolveSubagentAvailabilityFromSession(input.sdkSession);
    const handsOn = resolveMainAgentHandsOnCapability(input.agentRegistry?.profile);
    yield createPhaseBoundaryEvent(input.threadId, "execute", "【2/2】子代理执行");
    const isResume = Boolean(input.resume?.resumeSessionId);
    const planFile = planning.planFilePath?.trim()
      ? toWorkspaceRelativePlanFile(planning.planFilePath, input.workspacePath.trim() || input.worktreePath)
      : undefined;
    const resumableAppend = formatResumableSubagentsAppend(input.resumableSubagents ?? []);
    const prompt =
      input.executionPromptOverride ??
      (universalProfile
        ? buildUniversalExecutionPromptWithFollowUp(
            {
              ...planning,
              ...(planFile ? { approvedPlanFile: planFile } : {}),
              ...(input.resumableSubagents?.length ? { resumableSubagents: input.resumableSubagents } : {}),
            },
            input.prompt,
            { isResume, includePlanOnResume: planning.planUserEdited === true },
          )
        : buildExecutionPromptWithFollowUp(
            {
              ...planning,
              ...(planFile ? { approvedPlanFile: planFile } : {}),
              ...(input.resumableSubagents?.length ? { resumableSubagents: input.resumableSubagents } : {}),
            },
            input.prompt,
            {
              isResume,
              availability,
              capability: handsOn,
              includePlanOnResume: planning.planUserEdited === true,
            },
          ));
    yield* this.runSingleSession(input, {
      prompt,
      permissionMode: "acceptEdits",
      ...(isResume ? { approveDeferredExitPlanMode: true } : {}),
      allowedTools: [...executionAllowedTools],
      phaseAppend: `${
        universalProfile
          ? `${buildUniversalPhaseAppend("execute")}\n${buildMainAgentHandsOnBoundaryAppend(handsOn, availability, universalDelegateOptions)}`
          : buildExecutePhaseSystemAppend(availability, handsOn)
      }${resumableAppend}`,
      agents: createExecutionAgentDefinitions(input.routes, input.sdkSession?.agentSkills, availability),
      availability,
    });
  }

  async *runQuestion(input: AgentRuntimeRunInput): AsyncIterable<AgentEvent> {
    const universalProfile = usesUniversalAgentProfile(input);
    const availability = resolveSubagentAvailabilityFromSession(input.sdkSession);
    yield createPhaseBoundaryEvent(input.threadId, "answer", "【问答】只读回答");
    yield* this.runSingleSession(input, {
      prompt: universalProfile
        ? buildUniversalQuestionPrompt(input.prompt)
        : buildQuestionAnswerPrompt(input.prompt, availability),
      permissionMode: readOnlyPermissionMode,
      allowedTools: [...questionAllowedTools],
      phaseAppend: universalProfile
        ? buildUniversalPhaseAppend("answer")
        : buildQuestionAnswerSystemAppend(availability),
      agents: createQuestionAgentDefinitions(input.routes, input.sdkSession?.agentSkills, availability),
      availability,
    });
  }

  async *compactSession(input: AgentRuntimeRunInput): AsyncIterable<AgentEvent> {
    yield* this.runSlashCommand(input, "/compact", { permissionMode: "dontAsk" });
  }

  async rewindSessionFiles(input: AgentRuntimeRunInput, userMessageId: string): Promise<void> {
    if (!input.resume?.resumeSessionId) {
      throw new Error("rewindFiles requires an existing SDK session (resume).");
    }
    const sdk = await this.loadSdk();
    const plannerRoute = input.routes.find((route) => route.role === "planner") ?? input.routes[0];
    if (!plannerRoute) {
      throw new Error("At least one model route is required to rewind files");
    }
    const sessionCwd = input.workspacePath.trim() || input.worktreePath;
    const queryOptions: Record<string, unknown> = {
      cwd: sessionCwd,
      model: plannerRoute.primary.modelId,
      fallbackModel: plannerRoute.fallbacks[0]?.modelId,
      permissionMode: "dontAsk",
      allowedTools: [],
      systemPrompt: { type: "preset", preset: "claude_code", append: "" },
      tools: { type: "preset", preset: "claude_code" },
      env: buildSdkProcessEnv({
        apiKey: this.options.apiKey,
        baseUrl: this.options.baseUrl,
        ...(plannerRoute.thinkingEffort ? { thinkingEffort: plannerRoute.thinkingEffort } : {}),
      }),
      settings: {},
    };
    applySessionStoreToQueryOptions(queryOptions, this.options.sessionStore);
    applyResumeToQueryOptions(queryOptions, input.resume);
    applyEcoSdkSettings(queryOptions, this.options.apiKey, this.options.baseUrl);
    const query = sdk.query({ prompt: "", options: queryOptions });
    try {
      for await (const _message of query) {
        if (input.signal.aborted) {
          break;
        }
      }
      if (typeof query.rewindFiles !== "function") {
        throw new Error("SDK rewindFiles is not available (enable file checkpointing and update the SDK).");
      }
      const result = await query.rewindFiles(userMessageId);
      if (isRecord(result) && result.canRewind === false) {
        const reason =
          typeof result.reason === "string" && result.reason.trim()
            ? result.reason.trim()
            : "SDK reported that the checkpoint cannot be rewound.";
        throw new Error(reason);
      }
    } finally {
      query.close?.();
    }
  }

  async *runContinuation(
    input: AgentRuntimeRunInput,
    mode: "planning" | "execution" | "question",
    planning?: EcoPlanningContext,
  ): AsyncIterable<AgentEvent> {
    const universalProfile = usesUniversalAgentProfile(input);
    if (this.options.orchestration === "autonomous") {
      if (mode === "question") {
        const availability = resolveSubagentAvailabilityFromSession(input.sdkSession);
        yield createPhaseBoundaryEvent(input.threadId, "answer", "【续聊】只读回答");
        yield* this.runSingleSession(input, {
          prompt: universalProfile
            ? buildUniversalQuestionPrompt(input.prompt)
            : buildQuestionAnswerPrompt(input.prompt, availability),
          permissionMode: readOnlyPermissionMode,
          allowedTools: [...questionAllowedTools],
          phaseAppend: universalProfile
            ? buildUniversalPhaseAppend("answer")
            : buildQuestionAnswerSystemAppend(availability),
          agents: createQuestionAgentDefinitions(input.routes, input.sdkSession?.agentSkills, availability),
          availability,
        });
        return;
      }

      const availability = resolveSubagentAvailabilityFromSession(input.sdkSession);
      const continuationPrompt =
        mode === "execution" && planning
          ? universalProfile
            ? buildUniversalPlanContinuationPrompt({
                userPrompt: planning.userPrompt,
                analysis: planning.analysis,
                plan: planning.plan,
                ...(planning.planUserEdited ? { planUserEdited: true } : {}),
                followUp: input.prompt,
              })
            : buildAutonomousPlanContinuationPrompt({
                userPrompt: planning.userPrompt,
                analysis: planning.analysis,
                plan: planning.plan,
                ...(planning.planUserEdited ? { planUserEdited: true } : {}),
                followUp: input.prompt,
              })
          : input.prompt;
      yield createPhaseBoundaryEvent(
        input.threadId,
        mode === "execution" ? "execute" : "plan",
        mode === "execution" ? "【续聊】继续执行" : "【续聊】继续对话",
      );
      const autonomousHandsOn = resolveMainAgentHandsOnCapability(input.agentRegistry?.profile);
      yield* this.runSingleSession(input, {
        prompt: continuationPrompt,
        permissionMode: "acceptEdits",
        allowedTools: [...autonomousAllowedTools],
        phaseAppend: `${
          universalProfile
            ? buildUniversalPhaseAppend(mode === "planning" ? "plan" : "execute")
            : buildAutonomousOrchestratorAppend()
        }\n${buildMainAgentHandsOnBoundaryAppend(
          autonomousHandsOn,
          availability,
          universalProfile ? universalDelegateOptions : {},
        )}`,
        agents: createAutonomousAgentDefinitions(input.routes, input.sdkSession?.agentSkills, availability),
        availability,
      });
      return;
    }

    if (mode === "planning") {
      const availability = resolveSubagentAvailabilityFromSession(input.sdkSession);
      yield createPhaseBoundaryEvent(input.threadId, "plan", "【续聊】分析与制定计划");
      const planningResumableAppend = formatResumableSubagentsAppend(input.resumableSubagents ?? []);
      const planningPhaseAppend = `${
        universalProfile ? buildUniversalPhaseAppend("plan") : buildPlanningPhaseSystemAppend(availability)
      }${planningResumableAppend}`;
      const planningTranscript = yield* this.runSingleSession(input, {
        prompt: universalProfile
          ? buildUniversalPlanningContinuationPrompt(input.prompt)
          : buildPlanningContinuationPrompt(input.prompt, availability),
        permissionMode: "plan",
        planningPhase: true,
        allowedTools: [...planningAllowedTools],
        phaseAppend: planningPhaseAppend,
        agents: createPlanningAgentDefinitions(input.routes, input.sdkSession?.agentSkills, availability),
        availability,
      });
      if (input.signal.aborted) {
        return;
      }
      const finalizedPlan =
        planningTranscript.finalizedPlan ??
        resolvePlanningFinalizedPlanFromTranscript(planningTranscript.transcript);
      if (finalizedPlan) {
        yield createPlanReadyEvent(input.threadId, {
          userPrompt: input.prompt,
          analysis: finalizedPlan.analysis,
          plan: finalizedPlan.plan,
          ...(finalizedPlan.planFilePath ? { planFilePath: finalizedPlan.planFilePath } : {}),
        });
      }
      return;
    }

    if (mode === "question") {
      const availability = resolveSubagentAvailabilityFromSession(input.sdkSession);
      yield createPhaseBoundaryEvent(input.threadId, "answer", "【续聊】只读回答");
      yield* this.runSingleSession(input, {
        prompt: universalProfile
          ? buildUniversalQuestionPrompt(input.prompt)
          : buildQuestionAnswerPrompt(input.prompt, availability),
        permissionMode: "default",
        allowedTools: [...questionAllowedTools],
        phaseAppend: universalProfile
          ? buildUniversalPhaseAppend("answer")
          : buildQuestionAnswerSystemAppend(availability),
        agents: createQuestionAgentDefinitions(input.routes, input.sdkSession?.agentSkills, availability),
        availability,
      });
      return;
    }

    const availability = resolveSubagentAvailabilityFromSession(input.sdkSession);
    const handsOn = resolveMainAgentHandsOnCapability(input.agentRegistry?.profile);
    yield createPhaseBoundaryEvent(input.threadId, "execute", "【续聊】继续执行");
    const planFile = planning?.planFilePath?.trim()
      ? toWorkspaceRelativePlanFile(planning.planFilePath, input.workspacePath.trim() || input.worktreePath)
      : undefined;
    const executionPrompt = planning
      ? universalProfile
        ? buildUniversalExecutionPromptWithFollowUp(
            { ...planning, ...(planFile ? { approvedPlanFile: planFile } : {}) },
            input.prompt,
            {
            isResume: true,
            includePlanOnResume: false,
          })
        : buildExecutionPromptWithFollowUp(
            { ...planning, ...(planFile ? { approvedPlanFile: planFile } : {}) },
            input.prompt,
            {
            isResume: true,
            availability,
            capability: handsOn,
            includePlanOnResume: false,
          })
      : input.prompt;
    yield* this.runSingleSession(input, {
      prompt: executionPrompt,
      permissionMode: "acceptEdits",
      ...(input.resume?.resumeSessionId ? { approveDeferredExitPlanMode: true } : {}),
      allowedTools: [...executionAllowedTools],
      phaseAppend: universalProfile
        ? `${buildUniversalPhaseAppend("execute")}\n${buildMainAgentHandsOnBoundaryAppend(handsOn, availability, universalDelegateOptions)}`
        : buildExecutePhaseSystemAppend(availability, handsOn),
      agents: createExecutionAgentDefinitions(input.routes, input.sdkSession?.agentSkills, availability),
      availability,
    });
  }

  private async *runAutonomous(input: AgentRuntimeRunInput): AsyncIterable<AgentEvent> {
    const universalProfile = usesUniversalAgentProfile(input);
    const availability = resolveSubagentAvailabilityFromSession(input.sdkSession);
    const handsOn = resolveMainAgentHandsOnCapability(input.agentRegistry?.profile);
    yield* this.runSingleSession(input, {
      prompt: input.prompt,
      permissionMode: "acceptEdits",
      allowedTools: [...autonomousAllowedTools],
      phaseAppend: `${
        universalProfile ? buildUniversalPhaseAppend("autonomous") : buildAutonomousOrchestratorAppend()
      }\n${buildMainAgentHandsOnBoundaryAppend(handsOn, availability, universalProfile ? universalDelegateOptions : {})}`,
      agents: createAutonomousAgentDefinitions(input.routes, input.sdkSession?.agentSkills, availability),
      availability,
    });
  }

  private async *runPlanning(input: AgentRuntimeRunInput): AsyncIterable<AgentEvent> {
    const universalProfile = usesUniversalAgentProfile(input);
    const availability = resolveSubagentAvailabilityFromSession(input.sdkSession);
    yield createPhaseBoundaryEvent(input.threadId, "plan", "【1/2】分析与制定计划");
    const planningPhaseAppend = universalProfile
      ? buildUniversalPhaseAppend("plan")
      : buildPlanningPhaseSystemAppend(availability);
    const planningTranscript = yield* this.runSingleSession(input, {
      prompt: universalProfile
        ? buildUniversalPlanningPrompt(input.prompt)
        : buildPlanningPhasePrompt(input.prompt, availability),
      permissionMode: "plan",
      planningPhase: true,
      allowedTools: [...planningAllowedTools],
      phaseAppend: planningPhaseAppend,
      agents: createPlanningAgentDefinitions(input.routes, input.sdkSession?.agentSkills, availability),
      availability,
    });
    if (input.signal.aborted) {
      return;
    }
    const finalizedPlan =
      planningTranscript.finalizedPlan ??
      resolvePlanningFinalizedPlanFromTranscript(planningTranscript.transcript);
    if (finalizedPlan) {
      yield createPlanReadyEvent(input.threadId, {
        userPrompt: input.prompt,
        analysis: finalizedPlan.analysis,
        plan: finalizedPlan.plan,
        ...(finalizedPlan.planFilePath ? { planFilePath: finalizedPlan.planFilePath } : {}),
      });
    }
  }

  private async *runSingleSession(
    input: AgentRuntimeRunInput,
    phase: {
      prompt: string;
      permissionMode: "dontAsk" | "default" | "acceptEdits" | "plan";
      planningPhase?: boolean;
      /** Execution resume after Eco plan approval: complete the deferred ExitPlanMode call. */
      approveDeferredExitPlanMode?: boolean;
      allowedTools: string[];
      phaseAppend: string;
      agents?: Record<string, unknown>;
      availability?: SubagentAvailability;
      dynamicAgentKeys?: string[];
    },
  ): AsyncGenerator<AgentEvent, { transcript: string; finalizedPlan?: FinalizePlanPayload }> {
    const sdk = await this.loadSdk();
    const plannerRoute = findRoute(input.routes, "planner") ?? input.routes[0];
    if (!plannerRoute) {
      throw new Error("At least one model route is required to start Claude Agent SDK");
    }

    const systemAppend = [
      usesUniversalAgentProfile(input) ? universalEcoBasePromptAppend : ecoBasePromptAppend,
      phase.phaseAppend,
    ]
      .filter(Boolean)
      .join("\n\n");
    const session = resolveSdkSessionOptions(input.sdkSession);
    const dynamicAgents = input.agentRegistry
      ? createAgentDefinitionsFromProfile(input.agentRegistry.profile, input.agentRegistry.templates, {
          ...(input.sdkSession?.agentSkills && { agentSkills: input.sdkSession.agentSkills }),
        })
      : undefined;
    const dynamicProfileDefinitions =
      dynamicAgents && input.agentRegistry
        ? filterDynamicDefinitionsForPhase(
            dynamicAgents.definitions,
            phase.agents,
            input.agentRegistry.profile.preset,
            phase.dynamicAgentKeys,
          )
        : undefined;
    const dynamicDefinitions = mergeBuiltinExploreAgentDefinition(dynamicProfileDefinitions, phase.agents);
    const dynamicAgentKeys = dynamicDefinitions ? Object.keys(dynamicDefinitions) : undefined;
    const mainAllowedTools = input.agentRegistry
      ? resolveMainAgentAllowedTools(input.agentRegistry.profile, phase.allowedTools)
      : phase.allowedTools;
    let toolPermissions = input.agentRegistry
      ? buildToolPermissionPolicyFromProfile(input.agentRegistry.profile, input.agentRegistry.templates, {
          ...(dynamicAgentKeys ? { agentKeys: dynamicAgentKeys } : {}),
          mainAllowedTools,
        })
      : undefined;
    if (toolPermissions && phase.planningPhase) {
      toolPermissions = {
        ...toolPermissions,
        agents: {
          ...toolPermissions.agents,
          [SDK_PLAN_AGENT_KEY]: buildBuiltinPlanToolPermissionEntry(),
        },
      };
    }
    const pendingToolPermissionDecisions: EcoToolPermissionDecisionAudit[] = [];
    const onToolPermissionDecision = (decision: EcoToolPermissionDecisionAudit) => {
      this.options.hookContext?.onToolPermissionDecision?.(decision);
      pendingToolPermissionDecisions.push(decision);
    };
    let finalizedPlan: FinalizePlanPayload | undefined;
    const exitPlanCaptureState = phase.planningPhase ? { capturedToolUseIds: new Set<string>() } : undefined;
    const onExitPlanMode =
      phase.planningPhase
        ? (submission: { plan: string; planFilePath?: string }) => {
            const workspaceRoot = input.workspacePath.trim() || input.worktreePath;
            finalizedPlan = {
              analysis: buildExitPlanModeAnalysis(submission),
              plan: submission.plan,
              ...(submission.planFilePath
                ? {
                    planFilePath: toWorkspaceRelativePlanFile(submission.planFilePath, workspaceRoot),
                  }
                : {}),
            };
          }
        : undefined;
    const allowedSdkBuiltinAgentKeys = phase.planningPhase ? [SDK_PLAN_AGENT_KEY] : undefined;
    const approveDeferredExitPlanMode = !phase.planningPhase && phase.approveDeferredExitPlanMode === true;
    const shouldBuildHooks = Boolean(
      this.options.hookContext ||
        onExitPlanMode ||
        approveDeferredExitPlanMode ||
        dynamicAgentKeys ||
        toolPermissions,
    );
    const allowedTools = this.options.toolPermissionHandler
      ? stripBashAutoApprovedTools(mergeAllowedTools(mainAllowedTools, input.sdkSession))
      : mergeAllowedTools(mainAllowedTools, input.sdkSession);
    const mainModel = input.agentRegistry?.profile.mainAgent.modelRef.modelId ?? plannerRoute.primary.modelId;
    const systemPrompt = input.agentRegistry
      ? buildMainAgentSystemPrompt(
          input.agentRegistry.profile,
          input.agentRegistry.templates,
          systemAppend,
          this.options.excludeDynamicSections ? { excludeDynamicSections: true } : {},
        )
      : {
          type: "preset",
          preset: "claude_code",
          append: systemAppend,
          ...(this.options.excludeDynamicSections ? { excludeDynamicSections: true } : {}),
        };
    const sessionCwd = input.workspacePath.trim() || input.worktreePath;
    const queryOptions: Record<string, unknown> = {
      cwd: sessionCwd,
      model: mainModel,
      fallbackModel: plannerRoute.fallbacks[0]?.modelId,
      includePartialMessages: true,
      settingSources: session.settingSources,
      ...(session.skills && session.skills.length > 0 ? { skills: session.skills } : {}),
      permissionMode: phase.permissionMode,
      allowedTools,
      ...(phase.planningPhase ? { disallowedTools: [...planningDisallowedSdkTools] } : {}),
      ...(this.options.toolPermissionHandler
        ? { canUseTool: createCanUseTool(this.options.toolPermissionHandler) }
        : {}),
      systemPrompt,
      tools: { type: "preset", preset: "claude_code" },
      ...(shouldBuildHooks
        ? {
            hooks: buildEcoSdkHooks({
              ...(this.options.hookContext ?? {}),
              ...(onExitPlanMode ? { onExitPlanMode } : {}),
              ...(exitPlanCaptureState ? { exitPlanCaptureState } : {}),
              ...(approveDeferredExitPlanMode ? { approveDeferredExitPlanMode: true } : {}),
              ...(phase.planningPhase
                ? { getPhaseTranscript: () => phaseTranscriptBox.text }
                : {}),
              workspacePath: input.workspacePath,
              ...(dynamicAgentKeys ? { allowedAgentKeys: dynamicAgentKeys } : {}),
              ...(allowedSdkBuiltinAgentKeys ? { allowedSdkBuiltinAgentKeys } : {}),
              ...(toolPermissions ? { toolPermissions } : {}),
              ...(toolPermissions ? { onToolPermissionDecision } : {}),
              ...(this.options.toolPermissionHandler ? { forceBashApproval: true } : {}),
              subagentAvailability:
                phase.availability ?? resolveSubagentAvailabilityFromSession(input.sdkSession),
            }),
          }
        : {}),
      env: buildSdkProcessEnv({
        apiKey: this.options.apiKey,
        baseUrl: this.options.baseUrl,
        ...(plannerRoute.thinkingEffort ? { thinkingEffort: plannerRoute.thinkingEffort } : {}),
        ...(this.options.otel ? { otel: { ...this.options.otel, threadId: input.threadId } } : {}),
      }),
      settings: {},
    };

    applySessionStoreToQueryOptions(queryOptions, this.options.sessionStore);
    applyResumeToQueryOptions(queryOptions, input.resume);
    applyThinkingToQueryOptions(queryOptions, plannerRoute.thinkingEffort);
    applyEcoSdkSettings(queryOptions, this.options.apiKey, this.options.baseUrl, {
      ...(allowedSdkBuiltinAgentKeys ? { allowedSdkBuiltinAgentKeys } : {}),
    });

    if (Object.keys(session.mcpServers).length > 0) {
      queryOptions.mcpServers = session.mcpServers;
    }
    if (dynamicDefinitions) {
      queryOptions.agents = dynamicDefinitions;
    } else if (phase.agents) {
      queryOptions.agents = phase.agents;
    }

    const query = sdk.query({
      prompt: phase.prompt,
      options: queryOptions,
    });

    input.signal.addEventListener("abort", () => query.close?.(), { once: true });

    let transcript = "";
    const phaseTranscriptBox = { text: "" };
    let sessionCaptured = false;
    let activeSessionId = "unknown-session";
    const resolveSubagent = this.options.hookContext?.subagentAttribution?.resolveAgentId;
    const streamCtx = createSdkStreamContext({
      ...(resolveSubagent && {
        resolveSubagentAgentId: (input) =>
          resolveSubagent({
            role: input.role,
            sessionId: input.sessionId,
            ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
          }),
      }),
    });
    const slashPrompt = phase.prompt.trim().startsWith("/");
    const slashCommand = slashPrompt ? phase.prompt.trim().split(/\s+/)[0]?.toLowerCase() : "";
    let contextUsageCollected = false;
    for await (const message of query) {
      for (const event of drainToolPermissionDecisionEvents(input.threadId, pendingToolPermissionDecisions)) {
        yield event;
      }
      if (!sessionCaptured && isSdkInitMessage(message)) {
        const sessionId = readSdkSessionId(message);
        if (sessionId) {
          sessionCaptured = true;
          activeSessionId = sessionId;
          yield createSessionCapturedEvent(input.threadId, sessionId, sessionCwd);
        }
      }

      const checkpointId = readSdkUserMessageCheckpointId(message);
      if (checkpointId) {
        yield createFileCheckpointEvent(input.threadId, checkpointId);
      }

      let pendingContextEvents: AgentEvent[] = [];
      if (
        isRecord(message) &&
        message.type === "result" &&
        (!slashPrompt || slashCommand === "/compact") &&
        !contextUsageCollected &&
        typeof query.getContextUsage === "function"
      ) {
        contextUsageCollected = true;
        pendingContextEvents = await this.collectContextUsageEvents(query, input.threadId, activeSessionId);
      }

      // Calibrate planner context from getContextUsage before result billing usage.
      for (const contextEvent of pendingContextEvents) {
        yield contextEvent;
      }

      for (const event of mapSdkMessageToEvents(message, input.threadId, streamCtx)) {
        yield event;
        transcript = appendToPhaseTranscript(transcript, event);
        phaseTranscriptBox.text = transcript;
      }

      // Defer protocol primary channel: the result payload carries the deferred ExitPlanMode
      // call (`deferred_tool_use`). The PreToolUse capture covers the same tool use id, so
      // this only lands when the hook path missed it.
      if (onExitPlanMode) {
        await captureDeferredExitPlanModeFromResult(message, onExitPlanMode, exitPlanCaptureState, {
          searchRoots: [input.workspacePath, sessionCwd],
          getPhaseTranscript: () => phaseTranscriptBox.text,
        });
      }

      if (input.signal.aborted) {
        break;
      }
    }
    for (const event of drainToolPermissionDecisionEvents(input.threadId, pendingToolPermissionDecisions)) {
      yield event;
    }

    return { transcript: transcript.trim(), ...(finalizedPlan ? { finalizedPlan } : {}) };
  }

  /** Once per agent `result`, while the SDK query transport is still open. */
  private async collectContextUsageEvents(
    query: AsyncIterable<unknown> & { getContextUsage?: () => Promise<Record<string, unknown>> },
    threadId: string,
    sessionId: string,
  ): Promise<AgentEvent[]> {
    if (typeof query.getContextUsage !== "function") {
      return [];
    }
    try {
      const usage = await query.getContextUsage();
      this.options.onContextProbe?.("getContextUsage", {
        usage: usage as unknown as Record<string, unknown>,
        timing: "on_result",
      });
      const role: AgentRole = "planner";
      return [
        createAgentEvent({
          id: `${crypto.randomUUID()}:sdk-context-usage`,
          threadId,
          agentId: sessionId,
          role,
          type: "usage.recorded",
          payload: {
            type: "sdk_context_usage",
            ecoSdkContextUsage: usage,
          },
        }),
      ];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.options.onContextProbe?.("getContextUsage_error", {
        error: errorMessage,
        timing: "on_result",
      });
      return [];
    }
  }

  private async *runSlashCommand(
    input: AgentRuntimeRunInput,
    command: string,
    options: { permissionMode: "dontAsk" | "default" | "acceptEdits" },
  ): AsyncGenerator<AgentEvent, string> {
    if (!input.resume?.resumeSessionId) {
      throw new Error(`${command} requires an existing SDK session (resume).`);
    }
    const result = yield* this.runSingleSession(input, {
      prompt: command,
      permissionMode: options.permissionMode,
      allowedTools: [],
      phaseAppend: "",
    });
    return result.transcript;
  }

  private async loadSdk(): Promise<ClaudeAgentSdkModule> {
    if (this.options.loadSdk) {
      return this.options.loadSdk();
    }

    const dynamicImport = new Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<ClaudeAgentSdkModule>;
    return dynamicImport("@anthropic-ai/claude-agent-sdk");
  }
}

/** @deprecated Use createExecutionAgentDefinitions */
export function createAgentDefinitions(
  routes: readonly ResolvedModelRoute[],
  agentSkills?: Partial<Record<RuntimeAgentRole, string[]>>,
  availability?: SubagentAvailability,
): Record<string, unknown> {
  return createExecutionAgentDefinitions(routes, agentSkills, availability);
}

function createExploreAgentDefinition(
  routes: readonly ResolvedModelRoute[],
  agentSkills?: Partial<Record<RuntimeAgentRole, string[]>>,
): Record<string, unknown> {
  const routeByRole = new Map(routes.map((route) => [route.role, route]));
  return {
    description: exploreAgentDescription,
    ...agentDefinitionToolFields("explore", exploreSubagentTools, agentSkills),
    prompt: exploreAgentPrompt,
    model: toSdkAgentModel(routeByRole.get("explore")?.primary.modelId, "explore"),
  };
}

function mergeBuiltinExploreAgentDefinition(
  dynamicDefinitions: Record<string, unknown> | undefined,
  phaseDefinitions: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!dynamicDefinitions) {
    return undefined;
  }
  const exploreKey = ecoSubagentKeyForRole("explore");
  const exploreDefinition = phaseDefinitions?.[exploreKey];
  if (!exploreDefinition || dynamicDefinitions[exploreKey]) {
    return dynamicDefinitions;
  }
  return {
    [exploreKey]: exploreDefinition,
    ...dynamicDefinitions,
  };
}

export function createPlanningAgentDefinitions(
  routes: readonly ResolvedModelRoute[],
  agentSkills?: Partial<Record<RuntimeAgentRole, string[]>>,
  availability: SubagentAvailability = normalizeSubagentAvailability(),
): Record<string, unknown> {
  const routeByRole = new Map(routes.map((route) => [route.role, route]));
  const architectKey = ecoSubagentKeyForRole("architect");
  const definitions = {
    [ecoSubagentKeyForRole("explore")]: createExploreAgentDefinition(routes, agentSkills),
    [architectKey]: {
      description: planningArchitectDescription,
      ...agentDefinitionToolFields("architect", readOnlySubagentTools, agentSkills),
      prompt: planningArchitectPrompt,
      model: toSdkAgentModel(routeByRole.get("architect")?.primary.modelId, "architect"),
    },
  };

  return filterAgentDefinitions(definitions, availability);
}

export function createQuestionAgentDefinitions(
  routes: readonly ResolvedModelRoute[],
  agentSkills?: Partial<Record<RuntimeAgentRole, string[]>>,
  availability: SubagentAvailability = normalizeSubagentAvailability(),
): Record<string, unknown> {
  const definitions = {
    [ecoSubagentKeyForRole("explore")]: createExploreAgentDefinition(routes, agentSkills),
  };

  return filterAgentDefinitions(definitions, availability);
}

/** @deprecated Import from ./prompts/execution-agents.js */
export { reviewerAgentPrompt };

export function createExecutionAgentDefinitions(
  routes: readonly ResolvedModelRoute[],
  agentSkills?: Partial<Record<RuntimeAgentRole, string[]>>,
  availability: SubagentAvailability = normalizeSubagentAvailability(),
): Record<string, unknown> {
  const routeByRole = new Map(routes.map((route) => [route.role, route]));
  const architectKey = ecoSubagentKeyForRole("architect");
  const coderKey = ecoSubagentKeyForRole("coder");
  const reviewerKey = ecoSubagentKeyForRole("reviewer");
  const testerKey = ecoSubagentKeyForRole("tester");

  const definitions = {
    [ecoSubagentKeyForRole("explore")]: createExploreAgentDefinition(routes, agentSkills),
    [architectKey]: {
      description: executionArchitectDescription,
      ...agentDefinitionToolFields("architect", executionReadOnlySubagentTools, agentSkills),
      prompt: executionArchitectPrompt,
      model: toSdkAgentModel(routeByRole.get("architect")?.primary.modelId, "architect"),
    },
    [coderKey]: {
      description: executionCoderDescription,
      ...agentDefinitionToolFields("coder", executionCoderTools, agentSkills),
      prompt: executionCoderPrompt,
      model: toSdkAgentModel(routeByRole.get("coder")?.primary.modelId, "coder"),
    },
    [reviewerKey]: {
      description: autonomousReviewerDescription,
      ...agentDefinitionToolFields("reviewer", executionReadOnlySubagentBashTools, agentSkills),
      prompt: reviewerAgentPrompt,
      model: toSdkAgentModel(routeByRole.get("reviewer")?.primary.modelId, "reviewer"),
    },
    [testerKey]: {
      description: executionTesterDescription,
      ...agentDefinitionToolFields("tester", executionReadOnlySubagentBashTools, agentSkills),
      prompt: executionTesterPrompt,
      model: toSdkAgentModel(routeByRole.get("tester")?.primary.modelId, "tester"),
    },
  };

  return filterAgentDefinitions(definitions, availability);
}

const autonomousReviewerDescription = [
  "High-risk code review only: cross-module changes, security, or data-sensitive paths.",
  "Review ONLY this session's workspace changes (not full repo history).",
  "When NOT to use: low/medium risk — the main agent should self-review with Read/Grep/git diff instead.",
].join(" ");

export function createAutonomousAgentDefinitions(
  routes: readonly ResolvedModelRoute[],
  agentSkills?: Partial<Record<RuntimeAgentRole, string[]>>,
  availability: SubagentAvailability = defaultSubagentAvailability(),
): Record<string, unknown> {
  const routeByRole = new Map(routes.map((route) => [route.role, route]));
  const architectKey = ecoSubagentKeyForRole("architect");
  const coderKey = ecoSubagentKeyForRole("coder");
  const reviewerKey = ecoSubagentKeyForRole("reviewer");
  const testerKey = ecoSubagentKeyForRole("tester");
  return filterAgentDefinitions(
    {
      [ecoSubagentKeyForRole("explore")]: createExploreAgentDefinition(routes, agentSkills),
      [architectKey]: {
        description: executionArchitectDescription,
        ...agentDefinitionToolFields("architect", readOnlySubagentTools, agentSkills),
        prompt: executionArchitectPrompt,
        model: toSdkAgentModel(routeByRole.get("architect")?.primary.modelId, "architect"),
      },
      [coderKey]: {
        description: executionCoderDescription,
        ...agentDefinitionToolFields("coder", executionCoderTools, agentSkills),
        prompt: executionCoderPrompt,
        model: toSdkAgentModel(routeByRole.get("coder")?.primary.modelId, "coder"),
      },
      [reviewerKey]: {
        description: autonomousReviewerDescription,
        ...agentDefinitionToolFields("reviewer", readOnlySubagentBashTools, agentSkills),
        prompt: reviewerAgentPrompt,
        model: toSdkAgentModel(routeByRole.get("reviewer")?.primary.modelId, "reviewer"),
      },
      [testerKey]: {
        description: executionTesterDescription,
        ...agentDefinitionToolFields("tester", readOnlySubagentBashTools, agentSkills),
        prompt: executionTesterPrompt,
        model: toSdkAgentModel(routeByRole.get("tester")?.primary.modelId, "tester"),
      },
    },
    availability,
  );
}

export function toSdkAgentModel(modelId?: string, role = "subagent"): string {
  const resolved = modelId?.trim();
  if (!resolved) {
    throw new Error(`Missing model id for ${role} subagent. Subagents must use explicit models.`);
  }
  return resolved;
}

function filterDynamicDefinitionsForPhase(
  definitions: Record<string, unknown>,
  phaseDefinitions: Record<string, unknown> | undefined,
  preset: string,
  explicitAgentKeys?: readonly string[],
): Record<string, unknown> {
  if (explicitAgentKeys) {
    const explicit = new Set(explicitAgentKeys);
    return Object.fromEntries(Object.entries(definitions).filter(([key]) => explicit.has(key)));
  }
  if (preset !== "coding" || !phaseDefinitions) {
    return definitions;
  }
  const allowedKeys = new Set(Object.keys(phaseDefinitions));
  return Object.fromEntries(Object.entries(definitions).filter(([key]) => allowedKeys.has(key)));
}

export interface BuildSdkProcessEnvOptions {
  apiKey: string;
  baseUrl: string;
  otel?: EcoBuiltinOtelOptions;
  thinkingEffort?: ThinkingEffort;
}

/** Merge host env and force local router credentials so Claude Code does not call api.anthropic.com directly. */
export function buildSdkProcessEnv(options: BuildSdkProcessEnvOptions): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  env.ANTHROPIC_API_KEY = options.apiKey;
  env.ANTHROPIC_BASE_URL = options.baseUrl.replace(/\/+$/, "");
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "eco-coding";

  if (options.otel) {
    Object.assign(env, buildBuiltinOtelEnv(options.otel));
  }

  applyThinkingToProcessEnv(env, options.thinkingEffort);
  env.CLAUDE_CODE_DISABLE_WORKFLOWS = "1";

  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
}

export function getDefaultAllowedTools(): string[] {
  return [...defaultAllowedTools];
}

export function stripBashAutoApprovedTools(tools: readonly string[]): string[] {
  return tools.filter((tool) => tool.trim() !== "Bash");
}

/** SDK settings shared by every query(): disable Dynamic Workflows and route API credentials. */
export function applyEcoSdkSettings(
  queryOptions: Record<string, unknown>,
  apiKey: string,
  baseUrl: string,
  options: { allowedSdkBuiltinAgentKeys?: readonly string[] } = {},
): void {
  const existing = isRecord(queryOptions.settings) ? queryOptions.settings : {};
  const existingEnv = isRecord(existing.env) ? (existing.env as Record<string, string>) : {};
  const existingPermissions = isRecord(existing.permissions) ? existing.permissions : {};
  const existingDeny = Array.isArray(existingPermissions.deny) ? (existingPermissions.deny as string[]) : [];
  const deny = [
    ...new Set([...existingDeny, ...sdkBuiltinSubagentDenyRules(options.allowedSdkBuiltinAgentKeys)]),
  ];
  queryOptions.settings = {
    ...existing,
    disableWorkflows: true,
    plansDirectory: ".claude/plans",
    permissions: {
      ...existingPermissions,
      deny,
    },
    env: {
      ...existingEnv,
      ANTHROPIC_API_KEY: apiKey,
      ANTHROPIC_BASE_URL: baseUrl.replace(/\/+$/, ""),
    },
  };
}

export function applyResumeToQueryOptions(
  queryOptions: Record<string, unknown>,
  resume?: EcoSdkResumeOptions,
): void {
  if (resume?.resumeSessionId) {
    queryOptions.resume = resume.resumeSessionId;
  }
  if (resume?.resumeSessionAt) {
    queryOptions.resumeSessionAt = resume.resumeSessionAt;
  }
  if (resume?.forkSession) {
    queryOptions.forkSession = true;
  }
}

export function applySessionStoreToQueryOptions(
  queryOptions: Record<string, unknown>,
  sessionStore?: SessionStore,
): void {
  if (sessionStore) {
    queryOptions.sessionStore = sessionStore;
    delete queryOptions.enableFileCheckpointing;
    delete queryOptions.extraArgs;
    return;
  }
  queryOptions.enableFileCheckpointing = true;
  queryOptions.extraArgs = {
    ...(isRecord(queryOptions.extraArgs) ? (queryOptions.extraArgs as Record<string, unknown>) : {}),
    "replay-user-messages": null,
  };
}

export function readSdkUserMessageCheckpointId(message: unknown): string | undefined {
  if (!isRecord(message) || message.type !== "user") {
    return undefined;
  }
  return typeof message.uuid === "string" && message.uuid.trim() ? message.uuid.trim() : undefined;
}

export function createFileCheckpointEvent(threadId: string, userMessageId: string): AgentEvent {
  return createAgentEvent({
    id: `file-checkpoint:${userMessageId}`,
    type: "file.checkpoint",
    threadId,
    role: "planner",
    agentId: "eco-checkpoint",
    payload: { userMessageId },
  });
}

export function readSdkSessionId(message: unknown): string | undefined {
  if (!isRecord(message)) {
    return undefined;
  }
  return typeof message.session_id === "string" ? message.session_id : undefined;
}

export function isSdkInitMessage(message: unknown): boolean {
  return isRecord(message) && message.type === "system" && message.subtype === "init";
}

export function createSessionCapturedEvent(threadId: string, sessionId: string, cwd: string): AgentEvent {
  return createAgentEvent({
    id: `${threadId}:session:${sessionId}`,
    threadId,
    agentId: sessionId,
    role: "planner",
    type: "session.captured",
    payload: { sessionId, cwd },
  });
}

export function createToolPermissionDeniedEvent(
  threadId: string,
  decision: EcoToolPermissionDecisionAudit,
  uuidFactory: () => string = () => crypto.randomUUID(),
): AgentEvent {
  const subagentRole = normalizeSdkRuntimeAgentRole(decision.agentType ?? decision.actor);
  return createAgentEvent({
    id: `${threadId}:tool-permission-denied:${decision.toolUseId}:${uuidFactory()}`,
    threadId,
    agentId: decision.agentId ?? decision.sessionId ?? decision.actor,
    role: subagentRole ?? "planner",
    type: "tool.failed",
    payload: {
      type: "tool_permission_denied",
      tool_name: decision.toolName,
      tool_use_id: decision.toolUseId,
      permission_decision: decision.permissionDecision,
      message: decision.reason,
      actor: decision.actor,
      cwd: decision.cwd,
      ...(decision.sessionId && { session_id: decision.sessionId }),
      ...(decision.agentId && { agent_id: decision.agentId }),
      ...(decision.agentType && { agent_type: decision.agentType }),
    },
  });
}

function drainToolPermissionDecisionEvents(
  threadId: string,
  queue: EcoToolPermissionDecisionAudit[],
  uuidFactory: () => string = () => crypto.randomUUID(),
): AgentEvent[] {
  const events: AgentEvent[] = [];
  while (queue.length > 0) {
    const decision = queue.shift();
    if (decision) {
      events.push(createToolPermissionDeniedEvent(threadId, decision, uuidFactory));
    }
  }
  return events;
}

export {
  buildAnalyzePhasePrompt,
  buildExecuteBuildSwitchAppend,
  buildExecutePhasePrompt,
  buildExecutePhaseSystemAppend,
  buildExecuteResumePrompt,
  buildExecutionPromptWithFollowUp,
  buildPlanningPhasePrompt,
  buildPlanningPhaseSystemAppend,
  buildPlanPhasePrompt,
  buildQuestionAnswerPrompt,
  buildQuestionAnswerSystemAppend,
  executePhaseSystemAppend,
  planningPhaseSystemAppend,
  questionAnswerSystemAppend,
};

export function createPhaseBoundaryEvent(threadId: string, phase: EcoRunPhase, label: string): AgentEvent {
  return createAgentEvent({
    id: `${threadId}:eco-phase-${phase}-${crypto.randomUUID()}`,
    threadId,
    agentId: "eco-orchestrator",
    role: "planner",
    type: "agent.started",
    payload: { ecoPhase: phase, label },
  });
}

export function extractSdkRunFailure(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const isTerminalResult =
    payload.type === "result" || (payloadHasSdkResultShape(payload) && typeof payload.subtype === "string");

  if (!isTerminalResult) {
    return null;
  }

  if (payload.subtype === "success") {
    return null;
  }

  if (typeof payload.result === "string" && payload.result.trim()) {
    return payload.result.trim();
  }

  if (Array.isArray(payload.errors)) {
    const messages = payload.errors.filter((entry): entry is string => typeof entry === "string");
    if (messages.length > 0) {
      return messages.join("\n");
    }
  }

  return `Agent run failed (${String(payload.subtype ?? "error")}).`;
}

function payloadHasSdkResultShape(payload: Record<string, unknown>): boolean {
  return (
    "subtype" in payload && ("usage" in payload || "totalCostUsd" in payload || "total_cost_usd" in payload)
  );
}

export function readSdkSlashCommands(message: unknown): string[] {
  if (!isRecord(message) || message.type !== "system" || message.subtype !== "init") {
    return [];
  }
  const commands = message.slash_commands;
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((entry): entry is string => typeof entry === "string");
}

export function sdkSupportsSlashCommand(commands: readonly string[], name: string): boolean {
  const normalized = name.replace(/^\//, "").toLowerCase();
  return commands.some((entry) => entry.replace(/^\//, "").toLowerCase() === normalized);
}

export function extractCompactPostTokens(payload: unknown): number | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const meta =
    (isRecord(payload.compact_metadata) && payload.compact_metadata) ||
    (payload.subtype === "compact_boundary" && isRecord(payload.compact_metadata)
      ? payload.compact_metadata
      : undefined);
  if (!meta) {
    return undefined;
  }
  const post =
    typeof meta.post_tokens === "number"
      ? meta.post_tokens
      : typeof meta.postTokens === "number"
        ? meta.postTokens
        : undefined;
  return post !== undefined && Number.isFinite(post) ? post : undefined;
}

export function createPlanReadyEvent(threadId: string, payload: PlanReadyPayload): AgentEvent {
  return createAgentEvent({
    id: `${threadId}:plan-ready-${crypto.randomUUID()}`,
    threadId,
    agentId: "eco-orchestrator",
    role: "planner",
    type: "plan.ready",
    payload,
  });
}

export function appendToPhaseTranscript(transcript: string, event: AgentEvent): string {
  if (event.type === "usage.recorded") {
    return transcript;
  }

  const line = formatAgentEventLine(event);
  if (!line) {
    return transcript;
  }

  if (isStreamableAgentEventType(event.type) && isStreamPayload(event.payload)) {
    return mergeStreamText(transcript, line);
  }

  return transcript ? `${transcript}\n${line}` : line;
}

export type SdkTodoUpdatedKind = "task_started" | "task_updated" | "task_progress";

/** Payload for `todo.updated` events — mirrors Claude Agent SDK task system messages. */
export interface SdkTodoUpdatedPayload {
  sdkKind: SdkTodoUpdatedKind;
  task_id: string;
  description?: string;
  subagent_type?: string;
  task_type?: string;
  skip_transcript?: boolean;
  prompt?: string;
  last_tool_name?: string;
  summary?: string;
  patch?: {
    status?: string;
    description?: string;
    error?: string;
  };
}

export function buildSdkTodoUpdatedPayload(message: Record<string, unknown>): SdkTodoUpdatedPayload | null {
  const subtype = message.subtype;
  if (subtype !== "task_started" && subtype !== "task_updated" && subtype !== "task_progress") {
    return null;
  }

  const taskId = typeof message.task_id === "string" ? message.task_id : "";
  if (!taskId) {
    return null;
  }

  const payload: SdkTodoUpdatedPayload = {
    sdkKind: subtype,
    task_id: taskId,
  };

  if (typeof message.description === "string" && message.description.trim()) {
    payload.description = message.description.trim();
  }
  if (typeof message.subagent_type === "string" && message.subagent_type.trim()) {
    payload.subagent_type = message.subagent_type.trim();
  }
  if (typeof message.task_type === "string" && message.task_type.trim()) {
    payload.task_type = message.task_type.trim();
  }
  if (message.skip_transcript === true) {
    payload.skip_transcript = true;
  }
  if (typeof message.prompt === "string" && message.prompt.trim()) {
    payload.prompt = message.prompt.trim();
  }
  if (typeof message.last_tool_name === "string" && message.last_tool_name.trim()) {
    payload.last_tool_name = message.last_tool_name.trim();
  }
  if (typeof message.summary === "string" && message.summary.trim()) {
    payload.summary = message.summary.trim();
  }
  if (subtype === "task_updated" && isRecord(message.patch)) {
    const patch: SdkTodoUpdatedPayload["patch"] = {};
    if (typeof message.patch.status === "string") {
      patch.status = message.patch.status;
    }
    if (typeof message.patch.description === "string" && message.patch.description.trim()) {
      patch.description = message.patch.description.trim();
    }
    if (typeof message.patch.error === "string" && message.patch.error.trim()) {
      patch.error = message.patch.error.trim();
    }
    if (Object.keys(patch).length > 0) {
      payload.patch = patch;
    }
  }

  return payload;
}

function mapTaskSystemMessageToEvents(
  message: Record<string, unknown>,
  threadId: string,
  sessionId: string,
  role: RuntimeAgentRole,
  uuid: string,
): AgentEvent[] {
  const payload = buildSdkTodoUpdatedPayload(message);
  if (!payload) {
    return [];
  }

  return [
    createAgentEvent({
      id: `${uuid}:todo`,
      threadId,
      agentId: sessionId,
      role,
      type: "todo.updated",
      payload,
    }),
  ];
}

export function isCompactBoundarySdkMessage(message: unknown): boolean {
  if (!isRecord(message)) {
    return false;
  }
  return (
    (message.type === "system" && message.subtype === "compact_boundary") ||
    message.type === "compact_boundary"
  );
}

function mapCompactBoundaryToEvents(
  message: Record<string, unknown>,
  threadId: string,
  sessionId: string,
  role: RuntimeAgentRole,
  uuid: string,
): AgentEvent[] {
  const compactMetadata = isRecord(message.compact_metadata) ? message.compact_metadata : undefined;
  return [
    createAgentEvent({
      id: `${uuid}:compact`,
      threadId,
      agentId: sessionId,
      role,
      type: "agent.started",
      payload: {
        type: "system",
        subtype: "compact_boundary",
        ...(typeof message.session_id === "string" && { session_id: message.session_id }),
        ...(typeof message.compacted_summary === "string" && {
          compacted_summary: message.compacted_summary,
        }),
        ...(compactMetadata && { compact_metadata: compactMetadata }),
      },
    }),
  ];
}

export function mapSdkMessageToEvents(
  message: unknown,
  threadId: string,
  streamCtx?: SdkStreamContext,
): AgentEvent[] {
  if (!isRecord(message)) {
    return [];
  }

  const uuid = typeof message.uuid === "string" ? message.uuid : crypto.randomUUID();
  const sessionId = typeof message.session_id === "string" ? message.session_id : "unknown-session";
  const role = inferRole(message);

  if (isCompactBoundarySdkMessage(message)) {
    return mapCompactBoundaryToEvents(message, threadId, sessionId, role, uuid);
  }

  if (message.type === "system" && message.subtype === "init") {
    return [
      createAgentEvent({
        id: `${uuid}:init`,
        threadId,
        agentId: sessionId,
        role,
        type: "agent.started",
        payload: message,
      }),
    ];
  }

  if (message.type === "stream_event") {
    const ctx = streamCtx ?? createSdkStreamContext();
    const streamEvents = mapStreamEventToEvents(message, threadId, sessionId, role, uuid, ctx);
    if (streamEvents.length > 0) {
      return streamEvents;
    }
    return [
      createAgentEvent({
        id: `${uuid}:stream`,
        threadId,
        agentId: sessionId,
        role,
        type: "message.delta",
        payload: slimStreamEventMessage(message),
      }),
    ];
  }

  if (message.type === "assistant") {
    return mapAssistantMessageToEvents(message, threadId, sessionId, role, uuid, streamCtx);
  }

  if (message.type === "tool_progress") {
    const toolUseId = typeof message.tool_use_id === "string" ? message.tool_use_id : uuid;
    return [
      createAgentEvent({
        id: `${uuid}:tool-progress:${toolUseId}`,
        threadId,
        agentId: sessionId,
        role,
        type: "tool.started",
        payload: {
          ...message,
          ...(typeof message.subagent_type === "string" && { subagent_type: message.subagent_type }),
          ...(typeof message.agent_type === "string" && { agent_type: message.agent_type }),
        },
      }),
    ];
  }

  if (message.type === "result") {
    const resultPayload: Record<string, unknown> = {
      type: "result",
      totalCostUsd: message.total_cost_usd,
      usage: message.usage,
      modelUsage: message.modelUsage,
      subtype: message.subtype,
      ...(typeof message.result === "string" && { result: message.result }),
    };
    const attributed = applySubagentUsageAttribution({ role, sessionId, payload: resultPayload }, streamCtx);
    return [
      createAgentEvent({
        id: `${uuid}:usage`,
        threadId,
        agentId: attributed.agentId,
        role,
        type: "usage.recorded",
        payload: attributed.payload,
      }),
    ];
  }

  if (message.type === "system") {
    if (message.subtype === "thinking_tokens") {
      return [];
    }
    if (message.subtype === "task_progress") {
      return mapTaskSystemMessageToEvents(message, threadId, sessionId, role, uuid);
    }
    if (
      message.subtype === "status" ||
      message.subtype === "api_retry" ||
      message.subtype === "permission_denied"
    ) {
      return [
        createAgentEvent({
          id: `${uuid}:system`,
          threadId,
          agentId: sessionId,
          role,
          type: "agent.started",
          payload: message,
        }),
      ];
    }
  }

  if (message.type === "auth_status" && Array.isArray(message.output)) {
    return [
      createAgentEvent({
        id: `${uuid}:auth`,
        threadId,
        agentId: sessionId,
        role,
        type: "agent.started",
        payload: message,
      }),
    ];
  }

  if (message.type === "tool_use_summary") {
    return [
      createAgentEvent({
        id: `${uuid}:tool-summary`,
        threadId,
        agentId: sessionId,
        role,
        type: "tool.completed",
        payload: message,
      }),
    ];
  }

  return [];
}

function mapAssistantMessageToEvents(
  message: Record<string, unknown>,
  threadId: string,
  sessionId: string,
  role: RuntimeAgentRole,
  uuid: string,
  streamCtx?: SdkStreamContext,
): AgentEvent[] {
  const events: AgentEvent[] = [];

  if (isRecord(message.message)) {
    const nested = message.message;
    const messageId = typeof nested.id === "string" ? nested.id : undefined;
    if (isRecord(nested.usage)) {
      const assistantPayload: Record<string, unknown> = {
        usage: nested.usage,
        ...(messageId && { messageId }),
        ...(typeof nested.model === "string" && { model: nested.model }),
      };
      const attributed = applySubagentUsageAttribution(
        { role, sessionId, payload: assistantPayload },
        streamCtx,
      );
      events.push(
        createAgentEvent({
          id: `${uuid}:assistant-usage`,
          threadId,
          agentId: attributed.agentId,
          role,
          type: "usage.recorded",
          payload: attributed.payload,
        }),
      );
    }
  }

  if (!isRecord(message.message) || !Array.isArray(message.message.content)) {
    return events;
  }
  const content = expandAssistantMessageContent(
    message.message.content.filter((block): block is Record<string, unknown> => isRecord(block)),
  );
  for (const [index, block] of content.entries()) {
    if (!isRecord(block)) {
      continue;
    }
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      events.push(
        createAgentEvent({
          id: `${uuid}:text:${index}`,
          threadId,
          agentId: sessionId,
          role,
          type: "message.delta",
          payload: {
            type: "eco_stream",
            blockKind: "text",
            text: block.text,
            streamFinalize: true,
            ...(typeof message.parent_tool_use_id === "string" && {
              parent_tool_use_id: message.parent_tool_use_id,
            }),
            ...(typeof message.subagent_type === "string" && { subagent_type: message.subagent_type }),
            ...(typeof message.agent_type === "string" && { agent_type: message.agent_type }),
          },
        }),
      );
      continue;
    }
    if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
      events.push(
        createAgentEvent({
          id: `${uuid}:thinking:${index}`,
          threadId,
          agentId: sessionId,
          role,
          type: "message.delta",
          payload: {
            type: "eco_stream",
            blockKind: "thinking",
            text: block.thinking,
            streamFinalize: true,
            ...(typeof message.parent_tool_use_id === "string" && {
              parent_tool_use_id: message.parent_tool_use_id,
            }),
            ...(typeof message.subagent_type === "string" && { subagent_type: message.subagent_type }),
            ...(typeof message.agent_type === "string" && { agent_type: message.agent_type }),
          },
        }),
      );
      continue;
    }
    if (block.type !== "tool_use" || typeof block.name !== "string") {
      continue;
    }

    const toolUseId = typeof block.id === "string" ? block.id : undefined;
    if (toolUseId && streamCtx?.emittedToolUseIds.has(toolUseId)) {
      continue;
    }

    events.push(
      createAgentEvent({
        id: `${uuid}:tool:${index}`,
        threadId,
        agentId: sessionId,
        role,
        type: "tool.started",
        payload: {
          type: "tool_use",
          tool_name: block.name,
          input: block.input,
          ...(toolUseId && { tool_use_id: toolUseId }),
          ...(typeof message.parent_tool_use_id === "string" && {
            parent_tool_use_id: message.parent_tool_use_id,
          }),
          ...(typeof message.subagent_type === "string" && { subagent_type: message.subagent_type }),
          ...(typeof message.agent_type === "string" && { agent_type: message.agent_type }),
          ...(block.name === "Agent" &&
            isRecord(block.input) &&
            typeof block.input.subagent_type === "string" && {
              subagent_type: block.input.subagent_type,
            }),
        },
      }),
    );
  }

  return events;
}

export function createCanUseTool(
  handler: (request: SdkToolPermissionRequest) => Promise<SdkToolPermissionDecision>,
): (
  toolName: string,
  input: Record<string, unknown>,
  options: Record<string, unknown>,
) => Promise<Record<string, unknown>> {
  return async (toolName, input, options) => {
    const request: SdkToolPermissionRequest = {
      toolName,
      input,
      toolUseId: readStringOption(options, ["toolUseID", "toolUseId", "tool_use_id"]) ?? crypto.randomUUID(),
      signal: options.signal instanceof AbortSignal ? options.signal : new AbortController().signal,
    };
    const agentId = readStringOption(options, ["agentID", "agentId", "agent_id"]);
    const agentType = readStringOption(options, ["agentType", "agent_type"]);
    if (agentId) request.agentId = agentId;
    if (agentType) request.agentType = agentType;
    if (typeof options.cwd === "string") request.cwd = options.cwd;
    if (typeof options.blockedPath === "string") request.blockedPath = options.blockedPath;
    if (typeof options.decisionReason === "string") request.decisionReason = options.decisionReason;

    const decision = await handler(request);

    if (decision.behavior === "allow") {
      return {
        behavior: "allow",
        updatedInput: decision.updatedInput ?? input,
      };
    }

    return {
      behavior: "deny",
      message: decision.message,
      interrupt: decision.interrupt,
    };
  };
}

function readStringOption(options: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function findRoute(routes: readonly ResolvedModelRoute[], role: AgentRole): ResolvedModelRoute | undefined {
  return routes.find((route) => route.role === role);
}

function inferRole(message: Record<string, unknown>): RuntimeAgentRole {
  if (typeof message.subagent_type === "string") {
    const normalized = normalizeSdkRuntimeAgentRole(message.subagent_type);
    if (normalized) {
      return normalized;
    }
    if (isAgentRole(message.subagent_type)) {
      return message.subagent_type;
    }
  }
  if (typeof message.agent_type === "string") {
    const normalized = normalizeSdkRuntimeAgentRole(message.agent_type);
    if (normalized) {
      return normalized;
    }
    if (isAgentRole(message.agent_type)) {
      return message.agent_type;
    }
  }
  return "planner";
}

function isAgentRole(value: string): value is AgentRole {
  return ["planner", "explore", "architect", "coder", "reviewer", "tester"].includes(value);
}

function resolveActivitySubagentRole(value: string): ActivityDisplayRole | undefined {
  const normalized = normalizeSdkRuntimeAgentRole(value);
  if (normalized) {
    return normalized;
  }
  return isAgentRole(value) ? value : undefined;
}

function normalizeSdkRuntimeAgentRole(value: string): RuntimeAgentRole | undefined {
  const trimmed = value.trim();
  if (trimmed === SDK_GENERAL_PURPOSE_AGENT_KEY || trimmed === SDK_PLAN_AGENT_KEY) {
    return trimmed;
  }
  return normalizeSdkSubagentType(trimmed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ActivityDisplayRole = RuntimeAgentRole | "system" | "thinking" | "tool";

export interface AgentEventDisplay {
  message: string;
  role: ActivityDisplayRole;
  stream: boolean;
}

/** SDK / proxy status lines that should appear in the activity log while waiting on the model. */
export function isUpstreamStatusActivityMessage(message: string | null | undefined): boolean {
  if (!message?.trim()) {
    return false;
  }
  return /^(?:Requesting model|Compacting context|API retry )/i.test(message.trim());
}

export function formatAgentEventDisplay(
  event: Pick<AgentEvent, "type" | "payload" | "role">,
): AgentEventDisplay | null {
  if (isRecord(event.payload) && event.payload.type === "eco_stream" && event.payload.streamPlaceholder) {
    return {
      message: "",
      role: inferActivityRole(event),
      stream: true,
    };
  }

  const message = formatAgentEventLine(event);
  if (
    !message &&
    !(isRecord(event.payload) && event.payload.type === "eco_stream" && event.payload.streamFinalize)
  ) {
    return null;
  }

  const finalize =
    isRecord(event.payload) && event.payload.type === "eco_stream" && event.payload.streamFinalize === true;

  return {
    message: message ?? "",
    role: inferActivityRole(event),
    stream: finalize ? false : isStreamableAgentEventType(event.type) && isStreamPayload(event.payload),
  };
}

export function formatAgentEventLine(event: Pick<AgentEvent, "type" | "payload" | "role">): string | null {
  if (event.type === "usage.recorded" || event.type === "todo.updated") {
    if (event.type === "todo.updated" && isSdkTodoUpdatedPayload(event.payload)) {
      const sdkPayload = event.payload;
      if (sdkPayload.sdkKind === "task_updated") {
        const status = sdkPayload.patch?.status;
        return status ? `Task ${status}` : null;
      }
      return formatSdkPayloadMessage({
        type: "system",
        subtype: sdkPayload.sdkKind,
        task_id: sdkPayload.task_id,
        description: sdkPayload.description,
        subagent_type: sdkPayload.subagent_type,
        last_tool_name: sdkPayload.last_tool_name,
        summary: sdkPayload.summary,
      });
    }
    if (event.type === "usage.recorded") {
      return null;
    }
  }

  const fromPayload = formatSdkPayloadMessage(event.payload);
  if (fromPayload) {
    return fromPayload;
  }

  if (event.type === "agent.started") {
    return formatSdkPayloadMessage(event.payload) ?? "Agent session started.";
  }

  if (event.type === "plan.ready") {
    return "计划已生成，等待确认。";
  }

  if (
    event.type === "tool.started" &&
    isRecord(event.payload) &&
    typeof event.payload.tool_name === "string"
  ) {
    return `Running tool: ${event.payload.tool_name}`;
  }

  if (event.type === "tool.completed") {
    return formatSdkPayloadMessage(event.payload);
  }

  return null;
}

export function inferActivityRole(event: Pick<AgentEvent, "type" | "payload" | "role">): ActivityDisplayRole {
  if (isThinkingPayload(event.payload)) {
    return "thinking";
  }

  if (isRecord(event.payload)) {
    if (event.payload.type === "tool_permission_denied") {
      return "tool";
    }
    if (event.payload.type === "tool_progress" || event.payload.type === "tool_use_summary") {
      return "tool";
    }
    if (event.payload.type === "tool_use") {
      if (event.payload.tool_name === "Agent" && isRecord(event.payload.input)) {
        const subagent =
          (typeof event.payload.input.subagent_type === "string" && event.payload.input.subagent_type) ||
          (typeof event.payload.input.agent_type === "string" && event.payload.input.agent_type) ||
          undefined;
        const role = subagent ? resolveActivitySubagentRole(subagent) : undefined;
        if (role) {
          return role;
        }
      }
      if (typeof event.payload.subagent_type === "string") {
        const role = resolveActivitySubagentRole(event.payload.subagent_type);
        if (role) {
          return role;
        }
      }
      if (isRuntimeAgentActivityRole(event.role)) {
        return event.role;
      }
      return "tool";
    }
    if (typeof event.payload.subagent_type === "string") {
      const role = resolveActivitySubagentRole(event.payload.subagent_type);
      if (role) {
        return role;
      }
    }
    if (typeof event.payload.agent_type === "string") {
      const role = resolveActivitySubagentRole(event.payload.agent_type);
      if (role) {
        return role;
      }
    }
  }

  if (event.type === "todo.updated" && isRecord(event.payload)) {
    const subagent = event.payload.subagent_type;
    if (typeof subagent === "string") {
      const role = resolveActivitySubagentRole(subagent);
      if (role) {
        return role;
      }
    }
  }

  if (event.type === "tool.started" || event.type === "tool.completed") {
    if (isRuntimeAgentActivityRole(event.role)) {
      return event.role;
    }
    if (isRecord(event.payload) && event.payload.tool_name === "Agent" && isRecord(event.payload.input)) {
      const subagent =
        (typeof event.payload.input.subagent_type === "string" && event.payload.input.subagent_type) ||
        (typeof event.payload.input.agent_type === "string" && event.payload.input.agent_type) ||
        undefined;
      const role = subagent ? resolveActivitySubagentRole(subagent) : undefined;
      if (role) {
        return role;
      }
    }
    if (isRecord(event.payload) && typeof event.payload.subagent_type === "string") {
      const role = resolveActivitySubagentRole(event.payload.subagent_type);
      if (role) {
        return role;
      }
    }
    return "tool";
  }

  return event.role;
}

function isRuntimeAgentActivityRole(role: RuntimeAgentRole): boolean {
  return role !== "planner" && role !== "system" && role !== "thinking" && role !== "tool" && role !== "user";
}

export function isThinkingPayload(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  if (payload.type === "eco_stream" && payload.blockKind === "thinking") {
    return true;
  }

  if (payload.type === "stream_event" && isRecord(payload.event)) {
    const event = payload.event;
    if (
      event.type === "content_block_delta" &&
      isRecord(event.delta) &&
      event.delta.type === "thinking_delta"
    ) {
      return true;
    }
  }

  if (payload.type === "assistant" && isRecord(payload.message) && Array.isArray(payload.message.content)) {
    return payload.message.content.some(
      (block) => isRecord(block) && block.type === "thinking" && typeof block.thinking === "string",
    );
  }

  return false;
}

export function isStreamPayload(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }
  if (payload.type === "eco_stream") {
    return !payload.streamFinalize;
  }
  return payload.type === "stream_event";
}

export function formatSdkPayloadMessage(payload: unknown): string | null {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (!isRecord(payload)) {
    return null;
  }

  if (payload.type === "tool_permission_denied" && typeof payload.tool_name === "string") {
    const reason = typeof payload.message === "string" ? `: ${payload.message}` : "";
    return `Permission denied for ${payload.tool_name}${reason}`;
  }

  if (typeof payload.label === "string" && typeof payload.ecoPhase === "string") {
    return payload.label.trim() || null;
  }

  if (payload.type === "assistant" && isRecord(payload.message)) {
    return extractBetaMessageText(payload.message);
  }

  if (payload.type === "eco_stream") {
    if (payload.streamPlaceholder) {
      return null;
    }
    if (typeof payload.text === "string" && payload.text.length > 0) {
      return payload.text;
    }
    return null;
  }

  if (payload.type === "stream_event" && isRecord(payload.event)) {
    return extractStreamEventText(payload.event);
  }

  if (payload.type === "tool_use" && typeof payload.tool_name === "string") {
    if (payload.tool_name === "Agent") {
      const mission = formatAgentToolMissionMessage(payload.input);
      if (mission) {
        return mission;
      }
    }
    const detail = formatToolInputSummary(payload.tool_name, payload.input);
    return detail ? `Tool: ${payload.tool_name} · ${detail}` : `Tool: ${payload.tool_name}`;
  }

  if (payload.type === "tool_progress" && typeof payload.tool_name === "string") {
    const seconds =
      typeof payload.elapsed_time_seconds === "number"
        ? ` (${payload.elapsed_time_seconds.toFixed(1)}s)`
        : "";
    return `Tool: ${payload.tool_name}${seconds}`;
  }

  if (payload.type === "tool_use_summary" && typeof payload.summary === "string") {
    return payload.summary.trim() || null;
  }

  if (payload.type === "system") {
    if (payload.subtype === "init") {
      const model = typeof payload.model === "string" ? payload.model : "model";
      return `Claude Agent SDK ready (${model}).`;
    }
    if (payload.subtype === "notification" && typeof payload.text === "string") {
      return payload.text.trim() || null;
    }
    if (payload.subtype === "status") {
      if (payload.status === "requesting") {
        return "Requesting model…";
      }
      if (payload.status === "compacting") {
        return "Compacting context…";
      }
      return null;
    }
    if (payload.subtype === "compact_boundary") {
      return "Compacting context…";
    }
    if (payload.subtype === "task_started" && typeof payload.description === "string") {
      const subagent =
        (typeof payload.subagent_type === "string" && payload.subagent_type.trim()) ||
        (typeof payload.agent_type === "string" && payload.agent_type.trim()) ||
        undefined;
      if (subagent) {
        return formatSubagentMissionMessage(subagent, payload.description);
      }
      return `Task started: ${payload.description}`;
    }
    if (payload.subtype === "task_progress") {
      const description = typeof payload.description === "string" ? payload.description.trim() : "";
      const toolName = typeof payload.last_tool_name === "string" ? payload.last_tool_name.trim() : "";
      if (description && toolName) {
        return `Tool: ${toolName} · ${description}`;
      }
      if (toolName) {
        return `Tool: ${toolName}`;
      }
      return description || null;
    }
    if (payload.subtype === "task_updated" && isRecord(payload.patch)) {
      const status = payload.patch.status;
      if (typeof status === "string") {
        return `Task ${status}`;
      }
      return null;
    }
    if (payload.subtype === "api_retry") {
      const attempt = typeof payload.attempt === "number" ? payload.attempt : "?";
      const maxRetries = typeof payload.max_retries === "number" ? payload.max_retries : "?";
      return `API retry ${attempt}/${maxRetries}…`;
    }
    if (payload.subtype === "permission_denied" && typeof payload.tool_name === "string") {
      const reason = typeof payload.message === "string" ? `: ${payload.message}` : "";
      return `Permission denied for ${payload.tool_name}${reason}`;
    }
  }

  if (payload.type === "auth_status" && Array.isArray(payload.output)) {
    const lines = payload.output.filter(
      (line): line is string => typeof line === "string" && line.trim().length > 0,
    );
    return lines.length > 0 ? lines.join("\n") : null;
  }

  if (payload.type === "result") {
    return null;
  }

  if (payload.type === "user") {
    return null;
  }

  if (typeof payload.message === "string") {
    const trimmed = payload.message.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

function extractBetaMessageText(message: Record<string, unknown>): string | null {
  const content = message.content;
  if (!Array.isArray(content)) {
    return null;
  }

  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) {
      continue;
    }
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      parts.push(block.text);
      continue;
    }
    if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
      parts.push(block.thinking);
      continue;
    }
    if (block.type === "tool_use" && typeof block.name === "string") {
      const detail = formatToolInputSummary(block.name, block.input);
      parts.push(detail ? `[tool] ${block.name} · ${detail}` : `[tool] ${block.name}`);
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

function extractStreamEventText(event: Record<string, unknown>): string | null {
  if (event.type === "content_block_delta" && isRecord(event.delta)) {
    if (event.delta.type === "text_delta" && typeof event.delta.text === "string") {
      const text = event.delta.text;
      return text.length > 0 ? text : null;
    }
    if (event.delta.type === "thinking_delta" && typeof event.delta.thinking === "string") {
      const thinking = event.delta.thinking;
      return thinking.length > 0 ? thinking : null;
    }
  }

  return null;
}

const SUBAGENT_ROLE_LABELS: Record<SubagentRole, string> = {
  explore: "探索",
  architect: "架构",
  coder: "编码",
  reviewer: "审查",
  tester: "测试",
};

export function formatSubagentLabel(role: string): string {
  if (isSubagentRole(role)) {
    return SUBAGENT_ROLE_LABELS[role];
  }
  if (isAgentRole(role) && role !== "planner") {
    return role;
  }
  return role;
}

function isSdkTodoUpdatedPayload(payload: unknown): payload is SdkTodoUpdatedPayload {
  if (!isRecord(payload)) {
    return false;
  }
  const sdkKind = payload.sdkKind;
  if (sdkKind !== "task_started" && sdkKind !== "task_updated" && sdkKind !== "task_progress") {
    return false;
  }
  return typeof payload.task_id === "string" && payload.task_id.length > 0;
}

function formatAgentToolMissionMessage(input: unknown): string | null {
  if (!isRecord(input)) {
    return null;
  }
  const subagent =
    (typeof input.subagent_type === "string" && input.subagent_type.trim()) ||
    (typeof input.agent_type === "string" && input.agent_type.trim()) ||
    undefined;
  if (!subagent) {
    return null;
  }
  const prompt =
    (typeof input.prompt === "string" && input.prompt.trim()) ||
    (typeof input.task === "string" && input.task.trim()) ||
    (typeof input.description === "string" && input.description.trim()) ||
    "";
  return formatSubagentMissionMessage(subagent, prompt);
}

function formatToolInputSummary(toolName: string, input: unknown): string | null {
  if (!isRecord(input)) {
    return null;
  }

  if (toolName === "AskUserQuestion") {
    if (!Array.isArray(input.questions)) {
      return "澄清问题";
    }
    const count = input.questions.length;
    const first = input.questions[0];
    if (isRecord(first) && typeof first.question === "string") {
      const preview = first.question.trim();
      const short = preview.length > 48 ? `${preview.slice(0, 45)}…` : preview;
      return count > 1 ? `澄清 ${count} 个问题 · ${short}` : short;
    }
    return count > 1 ? `澄清 ${count} 个问题` : "澄清问题";
  }

  const skillName = resolveSkillDisplayName(toolName, input);
  if (skillName) {
    return `${skillName} 技能`;
  }

  if (toolName === "Agent") {
    const subagent =
      (typeof input.subagent_type === "string" && input.subagent_type.trim()) ||
      (typeof input.agent_type === "string" && input.agent_type.trim()) ||
      undefined;
    if (subagent) {
      const label = formatSubagentLabel(subagent);
      const taskPrompt = typeof input.prompt === "string" && input.prompt.trim() ? input.prompt.trim() : "";
      if (taskPrompt) {
        const summary = taskPrompt.length > 60 ? `${taskPrompt.slice(0, 57)}…` : taskPrompt;
        return `${label} · ${summary}`;
      }
      return label;
    }
  }

  const filePath =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.path === "string"
        ? input.path
        : undefined;
  if (filePath) {
    return pathBasename(filePath);
  }

  if (typeof input.command === "string") {
    const command = input.command.trim();
    return command.length > 80 ? `${command.slice(0, 77)}…` : command;
  }

  if (typeof input.pattern === "string") {
    return input.pattern;
  }

  return null;
}

function pathBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || filePath;
}

export function isStreamableAgentEventType(type: AgentEventType): boolean {
  return type === "message.delta";
}

export {
  createSdkStreamContext,
  isEcoStreamFinalize,
  isEcoStreamPlaceholder,
  type SdkStreamContext,
} from "./sdk-stream-events.js";
