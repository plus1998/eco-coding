import { createAgentEvent, type AgentEvent, type AgentRole } from "../../shared/src";
import type { ResolvedModelRoute } from "../../model-router/src";
import type { AgentRuntimeDriver, AgentRuntimeRunInput } from "./index";

type SdkQuery = (input: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<unknown> & {
  close?: () => void;
};

interface ClaudeAgentSdkModule {
  query: SdkQuery;
}

export interface ClaudeAgentSdkDriverOptions {
  apiKey: string;
  baseUrl: string;
  maxTurns?: number;
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
    const sdk = await this.loadSdk();
    const plannerRoute = findRoute(input.routes, "planner") ?? input.routes[0];
    if (!plannerRoute) {
      throw new Error("At least one model route is required to start Claude Agent SDK");
    }

    const query = sdk.query({
      prompt: input.prompt,
      options: {
        cwd: input.worktreePath,
        model: plannerRoute.primary.modelId,
        fallbackModel: plannerRoute.fallbacks[0]?.modelId,
        maxTurns: this.options.maxTurns ?? 24,
        includePartialMessages: true,
        enableFileCheckpointing: true,
        settingSources: ["project"],
        permissionMode: "default",
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: [
            "You are running inside Eco Coding, an agent command center.",
            "Work inside the provided isolated git worktree.",
            "Do not assume edits are applied to the user's real workspace until diff approval completes.",
          ].join("\n"),
        },
        tools: { type: "preset", preset: "claude_code" },
        agents: createAgentDefinitions(input.routes),
        canUseTool: this.options.canUseTool ? createCanUseTool(this.options.canUseTool) : undefined,
        env: {
          ANTHROPIC_API_KEY: this.options.apiKey,
          ANTHROPIC_BASE_URL: this.options.baseUrl,
          CLAUDE_AGENT_SDK_CLIENT_APP: "eco-coding",
        },
      },
    });

    input.signal.addEventListener("abort", () => query.close?.(), { once: true });

    for await (const message of query) {
      for (const event of mapSdkMessageToEvents(message, input.threadId)) {
        yield event;
      }

      if (input.signal.aborted) {
        break;
      }
    }
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
      description: "Analyze repository structure and propose implementation strategy.",
      tools: ["Read", "Glob", "Grep"],
      prompt: "Inspect the codebase and produce a concise implementation strategy.",
      model: toSdkAgentModel(routeByRole.get("architect")?.primary.modelId),
      maxTurns: 6,
    },
    coder: {
      description: "Implement code changes in the isolated worktree.",
      tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
      prompt: "Make focused code changes, keep edits patch-based, and report changed files.",
      model: toSdkAgentModel(routeByRole.get("coder")?.primary.modelId),
      maxTurns: 16,
    },
    reviewer: {
      description: "Review the produced diff for correctness, safety, and missing tests.",
      tools: ["Read", "Glob", "Grep", "Bash"],
      prompt: "Review the diff and list blocking issues before approval.",
      model: toSdkAgentModel(routeByRole.get("reviewer")?.primary.modelId),
      maxTurns: 8,
    },
    tester: {
      description: "Run targeted tests and explain failures.",
      tools: ["Read", "Bash", "Glob", "Grep"],
      prompt: "Run the narrowest useful tests and summarize failures with next actions.",
      model: toSdkAgentModel(routeByRole.get("tester")?.primary.modelId),
      maxTurns: 8,
    },
  };
}

export function toSdkAgentModel(modelId?: string): "opus" | "sonnet" | "haiku" | "inherit" {
  const normalized = modelId?.toLowerCase() ?? "";
  if (normalized.includes("opus")) return "opus";
  if (normalized.includes("sonnet")) return "sonnet";
  if (normalized.includes("haiku")) return "haiku";
  return "inherit";
}

export function mapSdkMessageToEvents(message: unknown, threadId: string): AgentEvent[] {
  if (!isRecord(message)) {
    return [];
  }

  const uuid = typeof message.uuid === "string" ? message.uuid : crypto.randomUUID();
  const sessionId = typeof message.session_id === "string" ? message.session_id : "unknown-session";
  const role = inferRole(message);

  if (message.type === "system" && message.subtype === "init") {
    return [createAgentEvent({
      id: `${uuid}:init`,
      threadId,
      agentId: sessionId,
      role,
      type: "agent.started",
      payload: message,
    })];
  }

  if (message.type === "assistant" || message.type === "stream_event") {
    return [createAgentEvent({
      id: `${uuid}:message`,
      threadId,
      agentId: sessionId,
      role,
      type: "message.delta",
      payload: message,
    })];
  }

  if (message.type === "tool_progress") {
    return [createAgentEvent({
      id: `${uuid}:tool-progress`,
      threadId,
      agentId: sessionId,
      role,
      type: "tool.started",
      payload: message,
    })];
  }

  if (message.type === "result") {
    return [createAgentEvent({
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
    })];
  }

  return [createAgentEvent({
    id: `${uuid}:raw`,
    threadId,
    agentId: sessionId,
    role,
    type: "message.delta",
    payload: message,
  })];
}

export function createCanUseTool(
  handler: (request: SdkToolPermissionRequest) => Promise<SdkToolPermissionDecision>,
): (toolName: string, input: Record<string, unknown>, options: Record<string, unknown>) => Promise<Record<string, unknown>> {
  return async (toolName, input, options) => {
    const decision = await handler({
      toolName,
      input,
      toolUseId: typeof options.toolUseID === "string" ? options.toolUseID : crypto.randomUUID(),
      agentId: typeof options.agentID === "string" ? options.agentID : undefined,
      blockedPath: typeof options.blockedPath === "string" ? options.blockedPath : undefined,
      decisionReason: typeof options.decisionReason === "string" ? options.decisionReason : undefined,
      signal: options.signal instanceof AbortSignal ? options.signal : new AbortController().signal,
    });

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
