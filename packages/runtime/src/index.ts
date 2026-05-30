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

export interface EcoSdkResumeOptions {
  /** Resume an existing SDK session by ID. */
  resumeSessionId?: string;
  /** Fork from resumeSessionId into a new session (explore alternatives). */
  forkSession?: boolean;
}

export interface AgentRuntimeRunInput {
  threadId: string;
  prompt: string;
  workspacePath: string;
  worktreePath: string;
  routes: ResolvedModelRoute[];
  signal: AbortSignal;
  sdkSession?: EcoSdkSessionOptions;
  resume?: EcoSdkResumeOptions;
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
  runContinuation?(
    input: AgentRuntimeRunInput,
    mode: "planning" | "execution" | "question",
  ): AsyncIterable<AgentEvent>;
  /** Sends `/compact` on an existing session (requires resume). */
  compactSession?(input: AgentRuntimeRunInput): AsyncIterable<AgentEvent>;
  /** Sends `/context` on an existing session (requires resume). */
  contextSnapshot?(input: AgentRuntimeRunInput): AsyncIterable<AgentEvent>;
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

export type { PlanReadyPayload, SessionCapturedPayload, AgentEvent } from "../../shared/src";
export * from "./eco-sdk-hooks";
export * from "./claude-agent-sdk";
export {
  buildBuiltinOtelEnv,
  mergeResourceAttributes,
  type EcoBuiltinOtelOptions,
} from "./otel-env";
export {
  parseOtelLogsPayload,
  parseOtelTracesPayload,
  type OtelActivityLine,
  type OtelActivityRole,
  type OtelUsageUpdate,
} from "./otel-activity";
export * from "./ask-user-question";
export * from "./reviewer-scope";
export { mergeStreamText } from "./stream-text";
export {
  formatSubagentMissionMessage,
  isToolElapsedDuration,
  missionFromAgentToolDetail,
  parseSubagentMissionMessage,
  summarizeAgentObjective,
  type SubagentMissionPayload,
} from "./agent-mission";
export {
  accumulateThreadCost,
  estimateContextTokens,
  formatCostUsd,
  formatRoleModelLabel,
  formatTokenCount,
  formatUsageBadge,
  mergeModelUsages,
  mergeUsageTotals,
  parseModelUsage,
  parseSdkContextUsage,
  parseSdkModelUsageBilling,
  parseSdkUsageBilling,
  parseUsagePayload,
  type SdkModelUsageBilling,
  shortenModelId,
  type ModelUsageEntry,
  type ParsedUsage,
} from "./usage";
export {
  computeRequestBilling,
  computeSavings,
  computeThreadBillingTotals,
  emptyCostBreakdown,
  estimateCostBreakdown,
  estimateCostFromTokens,
  formatSavingsLine,
  formatSavingsPct,
  mergeCostBreakdowns,
  tokenTotalsFromUsage,
  type ModelCostRates,
  type RequestBillingDelta,
  type ThreadBillingTotals,
  type TokenCostBreakdown,
  type TokenTotals,
} from "./billing";
export {
  fetchModelsDevCatalog,
  formatModelPricingLabel,
  lookupModelCostInCatalog,
  parseModelsDevCatalog,
  resolveProviderKeyFromBaseUrl,
  type ModelPricingLookup,
  type ModelsDevCatalog,
  type ModelsDevModelEntry,
} from "./models-dev-pricing";
export {
  extractCapabilitiesFromModelEntry,
  lookupModelCapabilitiesInCatalog,
  unresolvedModelCapabilities,
  type ModelCapabilities,
  type ModelCapabilitiesLookup,
} from "./models-dev-capabilities";
export {
  applyThinkingToMessagesBody,
  applyThinkingToProcessEnv,
  applyThinkingToQueryOptions,
  buildThinkingQueryPatch,
  isThinkingEffort,
  type ThinkingEffort,
  type ThinkingQueryPatch,
} from "./thinking-options";
export {
  computeOccupancyRatio,
  computeWindowOccupancy,
  DEFAULT_CONTEXT_LIMIT,
  lookupModelLimitsInCatalog,
  occupancyPercent,
  type ModelContextLimits,
  type ModelLimitsLookup,
} from "./models-dev-limits";
export {
  CONTEXT_SEGMENT_COLORS,
  CONTEXT_SEGMENT_LABELS,
  mergeBreakdownWithOccupancy,
  parseContextCommandResult,
  type ContextBreakdownSegment,
  type ContextSegmentKey,
} from "./context-breakdown";
export {
  extractPhaseDeliverable,
  extractPlanningDeliverables,
  findPlanSectionStart,
  stripPlanningTranscriptNoise,
} from "./phase-deliverable";
export {
  formatSkillActivityLabel,
  isSkillActivityLabel,
  resolveSkillDisplayName,
  skillNameFromPath,
} from "./skill-display";
