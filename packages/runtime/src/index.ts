import type { ResolvedModelRoute } from "../../model-router/src";
import type { EventStore, ThreadRecord } from "../../persistence/src";
import { type AgentEvent, type RuntimeAgentRole, createAgentEvent } from "../../shared/src";
import type { WorktreePlan } from "../../workspace/src";
import type { EcoAgentRuntimeConfig } from "./agent-orchestration.js";
import type { SubagentRole } from "./subagent-availability.js";

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
  /** Per-agent skill directories for subagent definitions. Keys may be built-in roles, profile agentKeys, or SDK eco_* keys. */
  agentSkills?: Partial<Record<RuntimeAgentRole, string[]>>;
  /** File read roots for project skills and explicitly referenced user skills in this SDK run. */
  implicitReadAllowRoots?: string[];
  /** Subagent on/off. */
  enabledSubagents?: Partial<Record<SubagentRole, boolean>>;
  mcpServers?: Record<string, unknown>;
  mcpAllowedTools?: string[];
}

export interface EcoSdkResumeOptions {
  /** Resume an existing SDK session by ID. */
  resumeSessionId?: string;
  /** Resume transcript up to and including this SDK message UUID. */
  resumeSessionAt?: string;
  /** Fork from resumeSessionId into a new session (explore alternatives). */
  forkSession?: boolean;
}

export interface ResumableSubagentRef {
  role: string;
  agentId: string;
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
  /** Stopped subagent sessions Eco may auto-Resume via PreToolUse. */
  resumableSubagents?: readonly ResumableSubagentRef[];
  /** Optional universal agent registry/profile used to generate SDK AgentDefinitions dynamically. */
  agentRegistry?: EcoAgentRuntimeConfig;
}

export interface EcoPlanningContext {
  userPrompt: string;
  analysis: string;
  plan: string;
  /** Claude Code `.claude/plans/` file path (workspace-relative when possible). */
  planFilePath?: string;
  /** User edited plan/analysis in Eco UI before approving execution. */
  planUserEdited?: boolean;
}

export interface AgentRuntimeDriver {
  run(input: AgentRuntimeRunInput): AsyncIterable<AgentEvent>;
  runQuestion?(input: AgentRuntimeRunInput): AsyncIterable<AgentEvent>;
  runContinuation?(
    input: AgentRuntimeRunInput,
    mode: "planning" | "execution" | "question",
    planning?: EcoPlanningContext,
  ): AsyncIterable<AgentEvent>;
  /** Sends `/compact` on an existing session (requires resume). */
  compactSession?(input: AgentRuntimeRunInput): AsyncIterable<AgentEvent>;
  /** Restores workspace files to a checkpoint user message (requires resume + file checkpointing). */
  rewindSessionFiles?(input: AgentRuntimeRunInput, userMessageId: string): Promise<void>;
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

export function buildRoleModelMap(routes: readonly ResolvedModelRoute[]): Record<RuntimeAgentRole, string> {
  return routes.reduce(
    (mapping, route) => {
      mapping[route.role] = route.primary.modelId;
      return mapping;
    },
    {} as Record<RuntimeAgentRole, string>,
  );
}

export type { AgentRole, RuntimeAgentRole, PlanReadyPayload, SessionCapturedPayload, AgentEvent } from "../../shared/src";
export type {
  SdkToolPermissionDecision,
  SdkToolPermissionRequest,
} from "./claude-agent-sdk";
export * from "./eco-sdk-hooks";
export {
  buildResumeAgentPrompt,
  createSubagentMissionCapturePreToolHook,
  createSubagentResumePreToolHook,
  formatResumableSubagentsAppend,
  isFreshSubagentRequest,
  readAgentSubagentType,
  type SubagentResumeHandoffInput,
  type SubagentResumeHookOptions,
  type SubagentResumeResolveInput,
} from "./subagent-resume.js";
export {
  buildFallbackSubagentHandoffSummary,
  buildSubagentCompactionSummaryPrompt,
  buildSubagentHandoffPrompt,
  DEFAULT_SUBAGENT_HANDOFF_THRESHOLD,
  estimateHandoffTokens,
  shouldHandoffSubagentResume,
  splitSubagentActivityForHandoff,
  type SubagentHandoffActivityLine,
} from "./subagent-handoff.js";
export * from "./subagent-availability";
export * from "./agent-orchestration";
export * from "./tool-permission-policy.js";
export * from "./filesystem-scope-policy.js";
export * from "./ask-user-question";
export * from "./reviewer-scope";
export { mergeStreamText } from "./stream-text";
export {
  apiErrorDedupeKey,
  formatApiErrorActivitySummary,
  formatApiErrorUserMessage,
  parseLegacyApiErrorActivityMessage,
  parseSdkApiErrorAttribute,
  type ThreadApiErrorInfo,
} from "./api-error";
export {
  formatSubagentMissionMessage,
  isGenericMissionSummary,
  isSubagentMissionEnvelope,
  isToolElapsedDuration,
  isWeakAgentToolDetail,
  missionFromAgentToolDetail,
  parseSubagentMissionMessage,
  resolveMissionDisplayText,
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
  normalizeOverlappingCacheContextUsage,
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
  buildModelPricingSummary,
  expandModelLookupCandidates,
  fetchModelsDevCatalog,
  filterOfficialModelsDevProviders,
  findModelEntryByKey,
  formatModelPricingLabel,
  formatRatePerMillion,
  isOfficialModelsDevProvider,
  lookupModelCostInCatalog,
  lookupModelCostByKey,
  listModelsDevCatalogOptions,
  parseModelsDevCatalog,
  resolveProviderKeyFromBaseUrl,
  type ModelPricingLookup,
  type ModelPricingSummary,
  type ModelsDevCatalog,
  type ModelsDevCatalogModelOption,
  type ModelsDevModelEntry,
  type ModelsDevProviderEntry,
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
  DEFAULT_AUTOCOMPACT_BUFFER,
  DEFAULT_CONTEXT_LIMIT,
  effectiveContextLimit,
  extractLimitsFromModelEntry,
  formatContextLimit,
  lookupModelLimitsInCatalog,
  occupancyPercent,
  type ModelContextLimits,
  type ModelLimitsLookup,
} from "./models-dev-limits";
export {
  CONTEXT_SEGMENT_COLORS,
  CONTEXT_SEGMENT_LABELS,
  contextSegmentDisplayLabel,
  alignBreakdownSegmentsToOccupied,
  mergeBreakdownWithOccupancy,
  normalizeContextSegments,
  parseContextCommandHeader,
  parseContextCommandResult,
  parseSdkGetContextUsageBreakdown,
  type ContextBreakdownSegment,
  type ContextCommandHeader,
  type ContextSegmentKey,
  type SdkContextUsageBreakdown,
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
