import type { ResolvedModelRoute } from "../../model-router/src";
import type { EventStore, ThreadRecord } from "../../persistence/src";
import { type AgentEvent, type AgentRole, createAgentEvent } from "../../shared/src";
import type { WorktreePlan } from "../../workspace/src";

export interface ThreadStartRequest {
  threadId: string;
  title: string;
  workspacePath: string;
  prompt: string;
  routes: ResolvedModelRoute[];
  worktree: WorktreePlan;
}

export type EcoSettingSource = "user" | "project" | "local";

export interface EcoSdkSessionOptions {
  /** Loads CLAUDE.md, rules, skills, hooks, and project .mcp.json */
  settingSources?: EcoSettingSource[];
  /** Main session (Planner) skill directories to preload */
  skills?: string[];
  /** Per-role skill directories for subagent definitions */
  agentSkills?: Partial<Record<AgentRole, string[]>>;
  mcpServers?: Record<string, unknown>;
  mcpAllowedTools?: string[];
}

export interface AgentRuntimeRunInput {
  threadId: string;
  prompt: string;
  workspacePath: string;
  worktreePath: string;
  routes: ResolvedModelRoute[];
  signal: AbortSignal;
  sdkSession?: EcoSdkSessionOptions;
}

export interface EcoPlanningContext {
  userPrompt: string;
  analysis: string;
  plan: string;
  /** User edited plan/analysis in Eco UI before approving execution. */
  planUserEdited?: boolean;
}

export interface AgentRuntimeDriver {
  run(input: AgentRuntimeRunInput): AsyncIterable<AgentEvent>;
  runExecution?(input: AgentRuntimeRunInput, planning: EcoPlanningContext): AsyncIterable<AgentEvent>;
  runQuestion?(input: AgentRuntimeRunInput): AsyncIterable<AgentEvent>;
}

export interface RunningThread {
  threadId: string;
  cancel(reason?: string): Promise<void>;
  done: Promise<void>;
}

export class ThreadSupervisor {
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly store: EventStore,
    private readonly driver: AgentRuntimeDriver,
  ) {}

  startThread(request: ThreadStartRequest): RunningThread {
    if (this.running.has(request.threadId)) {
      throw new Error(`Thread ${request.threadId} is already running`);
    }

    const controller = new AbortController();
    this.running.set(request.threadId, controller);

    const done = this.runThread(request, controller).finally(() => {
      this.running.delete(request.threadId);
    });

    return {
      threadId: request.threadId,
      done,
      cancel: async (reason = "cancelled by user") => {
        await this.cancelThread(request.threadId, reason);
      },
    };
  }

  async cancelThread(threadId: string, reason = "cancelled by user"): Promise<void> {
    const controller = this.running.get(threadId);
    if (!controller) {
      return;
    }
    controller.abort(reason);
  }

  isRunning(threadId: string): boolean {
    return this.running.has(threadId);
  }

  private async runThread(request: ThreadStartRequest, controller: AbortController): Promise<void> {
    const now = new Date().toISOString();
    await this.store.upsertThread({
      id: request.threadId,
      title: request.title,
      workspacePath: request.workspacePath,
      status: "running",
      createdAt: now,
      updatedAt: now,
    });

    await this.store.appendEvent(
      createAgentEvent({
        id: `${request.threadId}:thread-started`,
        threadId: request.threadId,
        agentId: "system",
        role: "planner",
        type: "thread.started",
        payload: { title: request.title, workspacePath: request.workspacePath },
      }),
    );

    try {
      for await (const event of this.driver.run({
        threadId: request.threadId,
        prompt: request.prompt,
        workspacePath: request.workspacePath,
        worktreePath: request.worktree.worktreePath,
        routes: request.routes,
        signal: controller.signal,
      })) {
        await this.store.appendEvent(event);
        if (controller.signal.aborted) {
          break;
        }
      }

      const status: ThreadRecord["status"] = controller.signal.aborted ? "cancelled" : "completed";
      await this.finishThread(request, status, controller.signal.reason);
    } catch (error) {
      await this.store.appendEvent(
        createAgentEvent({
          id: `${request.threadId}:thread-failed`,
          threadId: request.threadId,
          agentId: "system",
          role: "planner",
          type: "thread.failed",
          payload: { message: error instanceof Error ? error.message : String(error) },
        }),
      );
      await this.finishThread(request, "failed");
      throw error;
    }
  }

  private async finishThread(
    request: ThreadStartRequest,
    status: ThreadRecord["status"],
    reason?: unknown,
  ): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.store.getThread(request.threadId);
    await this.store.upsertThread({
      id: request.threadId,
      title: existing?.title ?? request.title,
      workspacePath: existing?.workspacePath ?? request.workspacePath,
      status,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    await this.store.appendEvent(
      createAgentEvent({
        id: `${request.threadId}:thread-${status}`,
        threadId: request.threadId,
        agentId: "system",
        role: "planner",
        type:
          status === "completed"
            ? "thread.completed"
            : status === "failed"
              ? "thread.failed"
              : "thread.completed",
        payload: { status, reason },
      }),
    );
  }
}

export function buildRoleModelMap(routes: readonly ResolvedModelRoute[]): Record<AgentRole, string> {
  return routes.reduce(
    (mapping, route) => {
      mapping[route.role] = route.primary.modelId;
      return mapping;
    },
    {} as Record<AgentRole, string>,
  );
}

export type { PlanReadyPayload } from "../../shared/src";
export * from "./claude-agent-sdk";
export * from "./ask-user-question";
export * from "./reviewer-scope";
export { mergeStreamText } from "./stream-text";
export {
  formatSubagentMissionMessage,
  missionFromAgentToolDetail,
  parseSubagentMissionMessage,
  summarizeAgentObjective,
  type SubagentMissionPayload,
} from "./agent-mission";
export {
  estimateContextTokens,
  formatRoleModelLabel,
  formatTokenCount,
  formatUsageBadge,
  mergeUsageTotals,
  parseUsagePayload,
  shortenModelId,
  type ParsedUsage,
} from "./usage";
export {
  extractPhaseDeliverable,
  extractPlanningDeliverables,
  findPlanSectionStart,
  stripPlanningTranscriptNoise,
} from "./phase-deliverable";
