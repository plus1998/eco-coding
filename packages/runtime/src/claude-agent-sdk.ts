import type { ResolvedModelRoute } from "../../model-router/src";
import {
  type AgentEvent,
  type AgentEventType,
  type AgentRole,
  type PlanReadyPayload,
  createAgentEvent,
} from "../../shared/src";
import type { AgentRuntimeDriver, AgentRuntimeRunInput, EcoPlanningContext } from "./index";

type SdkQuery = (input: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<unknown> & {
  close?: () => void;
};

interface ClaudeAgentSdkModule {
  query: SdkQuery;
}

const defaultAllowedTools = ["Agent", "Read", "Glob", "Grep", "Write", "Edit", "Bash"] as const;
const readOnlyTools = ["Read", "Glob", "Grep"] as const;
/** Read-only Eco phases: avoid Claude Code interactive plan mode (ExitPlanMode). */
const readOnlyPermissionMode = "dontAsk" as const;

const ecoBasePromptAppend = [
  "You are running inside Eco Coding, an agent command center.",
  "Work inside the provided isolated git worktree.",
  "Do not assume edits are applied to the user's real workspace until diff approval completes.",
].join("\n");

export type EcoOrchestrationMode = "analyze_plan_execute" | "sdk_default";

export type EcoRunPhase = "analyze" | "plan" | "execute";

export interface ClaudeAgentSdkDriverOptions {
  apiKey: string;
  baseUrl: string;
  maxTurns?: number;
  /** Default: analyze_plan_execute (main model analyzes → plans → subagents execute). */
  orchestration?: EcoOrchestrationMode;
  loadSdk?: () => Promise<ClaudeAgentSdkModule>;
  canUseTool?: (request: SdkToolPermissionRequest) => Promise<SdkToolPermissionDecision>;
}

export interface SdkToolPermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string;
  agentId?: string;
  blockedPath?: string;
  decisionReason?: string;
  signal: AbortSignal;
}

export type SdkToolPermissionDecision =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string; interrupt?: boolean };

export class ClaudeAgentSdkDriver implements AgentRuntimeDriver {
  constructor(private readonly options: ClaudeAgentSdkDriverOptions) {}

  async *run(input: AgentRuntimeRunInput): AsyncIterable<AgentEvent> {
    if (this.options.orchestration === "sdk_default") {
      yield* this.runSingleSession(input, {
        prompt: input.prompt,
        permissionMode: "acceptEdits",
        allowedTools: [...defaultAllowedTools],
        phaseAppend: "",
        includeAgents: true,
      });
      return;
    }

    yield* this.runPlanning(input);
  }

  async *runExecution(
    input: AgentRuntimeRunInput,
    planning: EcoPlanningContext,
  ): AsyncIterable<AgentEvent> {
    yield createPhaseBoundaryEvent(input.threadId, "execute", "【3/3】子代理执行");
    yield* this.runSingleSession(input, {
      prompt: buildExecutePhasePrompt(planning.userPrompt, planning.analysis, planning.plan),
      permissionMode: "acceptEdits",
      allowedTools: [...defaultAllowedTools],
      phaseAppend: executePhaseSystemAppend,
      includeAgents: true,
    });
  }

  private async *runPlanning(input: AgentRuntimeRunInput): AsyncIterable<AgentEvent> {
    yield createPhaseBoundaryEvent(input.threadId, "analyze", "【1/3】分析与推理");
    const analysis = yield* this.runSingleSession(input, {
      prompt: buildAnalyzePhasePrompt(input.prompt),
      permissionMode: readOnlyPermissionMode,
      allowedTools: [...readOnlyTools],
      phaseAppend: analyzePhaseSystemAppend,
      includeAgents: false,
    });
    if (input.signal.aborted) {
      return;
    }

    yield createPhaseBoundaryEvent(input.threadId, "plan", "【2/3】制定详细计划");
    const plan = yield* this.runSingleSession(input, {
      prompt: buildPlanPhasePrompt(input.prompt, analysis),
      permissionMode: readOnlyPermissionMode,
      allowedTools: [...readOnlyTools],
      phaseAppend: planPhaseSystemAppend,
      includeAgents: false,
    });
    if (input.signal.aborted) {
      return;
    }

    yield createPlanReadyEvent(input.threadId, {
      userPrompt: input.prompt,
      analysis,
      plan,
    });
  }

  private async *runSingleSession(
    input: AgentRuntimeRunInput,
    phase: {
      prompt: string;
      permissionMode: "dontAsk" | "acceptEdits";
      allowedTools: string[];
      phaseAppend: string;
      includeAgents: boolean;
    },
  ): AsyncGenerator<AgentEvent, string> {
    const sdk = await this.loadSdk();
    const plannerRoute = findRoute(input.routes, "planner") ?? input.routes[0];
    if (!plannerRoute) {
      throw new Error("At least one model route is required to start Claude Agent SDK");
    }

    const systemAppend = [ecoBasePromptAppend, phase.phaseAppend].filter(Boolean).join("\n\n");
    const queryOptions: Record<string, unknown> = {
      cwd: input.worktreePath,
      model: plannerRoute.primary.modelId,
      fallbackModel: plannerRoute.fallbacks[0]?.modelId,
      includePartialMessages: true,
      enableFileCheckpointing: true,
      settingSources: ["project"],
      permissionMode: phase.permissionMode,
      allowedTools: phase.allowedTools,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: systemAppend,
      },
      tools: { type: "preset", preset: "claude_code" },
      canUseTool: this.options.canUseTool ? createCanUseTool(this.options.canUseTool) : undefined,
      env: {
        ANTHROPIC_API_KEY: this.options.apiKey,
        ANTHROPIC_BASE_URL: this.options.baseUrl,
        CLAUDE_AGENT_SDK_CLIENT_APP: "eco-coding",
      },
    };

    if (phase.includeAgents) {
      queryOptions.agents = createAgentDefinitions(input.routes);
    }

    if (this.options.maxTurns !== undefined) {
      queryOptions.maxTurns = this.options.maxTurns;
    }

    const query = sdk.query({
      prompt: phase.prompt,
      options: queryOptions,
    });

    input.signal.addEventListener("abort", () => query.close?.(), { once: true });

    let transcript = "";
    for await (const message of query) {
      for (const event of mapSdkMessageToEvents(message, input.threadId)) {
        yield event;
        transcript = appendToPhaseTranscript(transcript, event);
      }

      if (input.signal.aborted) {
        break;
      }
    }

    return transcript.trim();
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

export function createAgentDefinitions(routes: readonly ResolvedModelRoute[]): Record<string, unknown> {
  const routeByRole = new Map(routes.map((route) => [route.role, route]));

  return {
    architect: {
      description:
        "Execution phase only: inspect the repo and refine strategy when the approved plan needs structural guidance.",
      tools: ["Read", "Glob", "Grep"],
      prompt: "Follow the approved plan. Inspect the codebase only when needed and return concise guidance.",
      model: toSdkAgentModel(routeByRole.get("architect")?.primary.modelId),
    },
    coder: {
      description: "Execution phase only: implement approved plan steps with focused code edits in the worktree.",
      tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
      prompt: "Implement the approved plan with patch-based edits. Report changed files.",
      model: toSdkAgentModel(routeByRole.get("coder")?.primary.modelId),
    },
    reviewer: {
      description: "Execution phase only: review the diff for correctness, safety, and missing tests.",
      tools: ["Read", "Glob", "Grep", "Bash"],
      prompt: "Review changes against the approved plan. List blocking issues before completion.",
      model: toSdkAgentModel(routeByRole.get("reviewer")?.primary.modelId),
    },
    tester: {
      description: "Execution phase only: run targeted tests and explain failures.",
      tools: ["Read", "Bash", "Glob", "Grep"],
      prompt: "Run the narrowest useful tests for the approved plan and summarize failures with next actions.",
      model: toSdkAgentModel(routeByRole.get("tester")?.primary.modelId),
    },
  };
}

export function toSdkAgentModel(modelId?: string): string {
  return modelId?.trim() || "inherit";
}

export function getDefaultAllowedTools(): string[] {
  return [...defaultAllowedTools];
}

const analyzePhaseSystemAppend = [
  "Eco orchestration phase 1/3 — ANALYZE ONLY.",
  "Use the main model to think step by step: clarify goals, constraints, risks, and what to inspect in the repo.",
  "You may use Read, Glob, and Grep only.",
  "Do NOT call the Agent tool. Do NOT modify files. Do NOT write a full implementation plan yet — analysis only.",
].join("\n");

const planPhaseSystemAppend = [
  "Eco orchestration phase 2/3 — PLAN ONLY.",
  "Using the analysis from phase 1, produce a detailed, ordered implementation plan in your final response.",
  "Include concrete steps, files/areas to touch, verification, and rollback notes.",
  "You may use Read, Glob, and Grep only.",
  "Do NOT call the Agent tool. Do NOT modify files. Do NOT start implementation.",
  "Do NOT use ExitPlanMode or Claude Code plan mode tools — Eco will show your plan to the user for approval.",
].join("\n");

const executePhaseSystemAppend = [
  "Eco orchestration phase 3/3 — EXECUTE.",
  "The analysis and detailed plan are authoritative. Implement by delegating to subagents (architect, coder, reviewer, tester) via the Agent tool when appropriate.",
  "Do not replan from scratch unless the plan is blocked; extend the plan minimally if discoveries require it.",
].join("\n");

export function buildAnalyzePhasePrompt(userPrompt: string): string {
  return [
    "User request:",
    userPrompt.trim(),
    "",
    "Phase 1 task: Analyze and reason about this request. Explore the codebase if needed. Output your reasoning and findings only.",
  ].join("\n");
}

export function buildPlanPhasePrompt(userPrompt: string, analysis: string): string {
  return [
    "User request:",
    userPrompt.trim(),
    "",
    "Phase 1 analysis (completed):",
    analysis.trim() || "(no analysis captured)",
    "",
    "Phase 2 task: Write a detailed implementation plan the execution phase must follow. Use clear numbered steps.",
  ].join("\n");
}

export function buildExecutePhasePrompt(userPrompt: string, analysis: string, plan: string): string {
  return [
    "User request:",
    userPrompt.trim(),
    "",
    "Phase 1 analysis:",
    analysis.trim() || "(no analysis captured)",
    "",
    "Phase 2 plan (follow this):",
    plan.trim() || "(no plan captured)",
    "",
    "Phase 3 task: Execute the plan. Use subagents for specialized work. Apply changes in the worktree.",
  ].join("\n");
}

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
  const line = formatAgentEventLine(event);
  if (!line) {
    return transcript;
  }

  if (isStreamableAgentEventType(event.type) && isStreamPayload(event.payload)) {
    return `${transcript}${line}`;
  }

  return transcript ? `${transcript}\n${line}` : line;
}

export function mapSdkMessageToEvents(message: unknown, threadId: string): AgentEvent[] {
  if (!isRecord(message)) {
    return [];
  }

  const uuid = typeof message.uuid === "string" ? message.uuid : crypto.randomUUID();
  const sessionId = typeof message.session_id === "string" ? message.session_id : "unknown-session";
  const role = inferRole(message);

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
    return [
      createAgentEvent({
        id: `${uuid}:stream`,
        threadId,
        agentId: sessionId,
        role,
        type: "message.delta",
        payload: message,
      }),
    ];
  }

  if (message.type === "assistant") {
    return mapAssistantMessageToEvents(message, threadId, sessionId, role, uuid);
  }

  if (message.type === "tool_progress") {
    return [];
  }

  if (message.type === "result") {
    return [
      createAgentEvent({
        id: `${uuid}:usage`,
        threadId,
        agentId: sessionId,
        role,
        type: "usage.recorded",
        payload: {
          totalCostUsd: message.total_cost_usd,
          usage: message.usage,
          modelUsage: message.modelUsage,
          subtype: message.subtype,
        },
      }),
    ];
  }

  if (message.type === "system") {
    if (message.subtype === "thinking_tokens") {
      return [];
    }
    if (
      message.subtype === "status" ||
      message.subtype === "task_started" ||
      message.subtype === "task_progress" ||
      message.subtype === "task_updated" ||
      message.subtype === "notification" ||
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
  role: AgentRole,
  uuid: string,
): AgentEvent[] {
  if (!isRecord(message.message) || !Array.isArray(message.message.content)) {
    return [];
  }

  const events: AgentEvent[] = [];
  for (const [index, block] of message.message.content.entries()) {
    if (!isRecord(block) || block.type !== "tool_use" || typeof block.name !== "string") {
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
      toolUseId: typeof options.toolUseID === "string" ? options.toolUseID : crypto.randomUUID(),
      signal: options.signal instanceof AbortSignal ? options.signal : new AbortController().signal,
    };
    if (typeof options.agentID === "string") request.agentId = options.agentID;
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

function findRoute(routes: readonly ResolvedModelRoute[], role: AgentRole): ResolvedModelRoute | undefined {
  return routes.find((route) => route.role === role);
}

function inferRole(message: Record<string, unknown>): AgentRole {
  if (typeof message.subagent_type === "string" && isAgentRole(message.subagent_type)) {
    return message.subagent_type;
  }
  if (typeof message.agent_type === "string" && isAgentRole(message.agent_type)) {
    return message.agent_type;
  }
  return "planner";
}

function isAgentRole(value: string): value is AgentRole {
  return ["planner", "architect", "coder", "reviewer", "tester"].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ActivityDisplayRole = AgentRole | "system" | "thinking" | "tool";

export interface AgentEventDisplay {
  message: string;
  role: ActivityDisplayRole;
  stream: boolean;
}

export function formatAgentEventDisplay(
  event: Pick<AgentEvent, "type" | "payload" | "role">,
): AgentEventDisplay | null {
  const message = formatAgentEventLine(event);
  if (!message) {
    return null;
  }

  return {
    message,
    role: inferActivityRole(event),
    stream: isStreamableAgentEventType(event.type) && isStreamPayload(event.payload),
  };
}

export function formatAgentEventLine(
  event: Pick<AgentEvent, "type" | "payload" | "role">,
): string | null {
  const fromPayload = formatSdkPayloadMessage(event.payload);
  if (fromPayload) {
    return fromPayload;
  }

  if (event.type === "agent.started") {
    return formatSdkPayloadMessage(event.payload) ?? "Agent session started.";
  }

  if (event.type === "usage.recorded") {
    return formatUsagePayload(event.payload);
  }

  if (event.type === "plan.ready" && isRecord(event.payload) && typeof event.payload.plan === "string") {
    return event.payload.plan.trim() || null;
  }

  if (event.type === "tool.started" && isRecord(event.payload) && typeof event.payload.tool_name === "string") {
    return `Running tool: ${event.payload.tool_name}`;
  }

  if (event.type === "tool.completed") {
    return formatSdkPayloadMessage(event.payload);
  }

  return null;
}

export function inferActivityRole(
  event: Pick<AgentEvent, "type" | "payload" | "role">,
): ActivityDisplayRole {
  if (isThinkingPayload(event.payload)) {
    return "thinking";
  }

  if (isRecord(event.payload)) {
    if (event.payload.type === "tool_progress" || event.payload.type === "tool_use_summary") {
      return "tool";
    }
    if (typeof event.payload.subagent_type === "string" && isAgentRole(event.payload.subagent_type)) {
      return event.payload.subagent_type;
    }
  }

  if (event.type === "tool.started" || event.type === "tool.completed") {
    return "tool";
  }

  return event.role;
}

export function isThinkingPayload(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  if (payload.type === "stream_event" && isRecord(payload.event)) {
    const event = payload.event;
    if (event.type === "content_block_delta" && isRecord(event.delta) && event.delta.type === "thinking_delta") {
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
  return isRecord(payload) && payload.type === "stream_event";
}

export function formatSdkPayloadMessage(payload: unknown): string | null {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (!isRecord(payload)) {
    return null;
  }

  if (typeof payload.label === "string" && typeof payload.ecoPhase === "string") {
    return payload.label.trim() || null;
  }

  if (payload.type === "assistant" && isRecord(payload.message)) {
    return extractBetaMessageText(payload.message);
  }

  if (payload.type === "stream_event" && isRecord(payload.event)) {
    return extractStreamEventText(payload.event);
  }

  if (payload.type === "tool_use" && typeof payload.tool_name === "string") {
    const detail = formatToolInputSummary(payload.input);
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
    if (payload.subtype === "task_started" && typeof payload.description === "string") {
      return `Task started: ${payload.description}`;
    }
    if (payload.subtype === "task_progress") {
      const description = typeof payload.description === "string" ? payload.description : "Task";
      const tool = typeof payload.last_tool_name === "string" ? ` · ${payload.last_tool_name}` : "";
      return `${description}${tool}`;
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
    const lines = payload.output.filter((line): line is string => typeof line === "string" && line.trim().length > 0);
    return lines.length > 0 ? lines.join("\n") : null;
  }

  if (payload.type === "result") {
    if (typeof payload.total_cost_usd === "number") {
      return `Run finished (cost $${payload.total_cost_usd.toFixed(4)}).`;
    }
    return "Run finished.";
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

function formatUsagePayload(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return "Usage recorded.";
  }
  if (typeof payload.totalCostUsd === "number") {
    return `Usage recorded (cost $${payload.totalCostUsd.toFixed(4)}).`;
  }
  if (typeof payload.total_cost_usd === "number") {
    return `Usage recorded (cost $${payload.total_cost_usd.toFixed(4)}).`;
  }
  return "Usage recorded.";
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
      const detail = formatToolInputSummary(block.input);
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

function formatToolInputSummary(input: unknown): string | null {
  if (!isRecord(input)) {
    return null;
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
