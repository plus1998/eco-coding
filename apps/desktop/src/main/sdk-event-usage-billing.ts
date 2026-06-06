import {
  parseSdkContextUsage,
  parseSdkUsageBilling,
  type ParsedUsage,
} from "@eco/runtime";
import type { AgentRole } from "../shared/ipc";
import {
  buildAssistantUsageRequestKey,
  isSdkIncrementalStreamUsage,
  isSubagentBillingRole,
  shouldBillAssistantSubagentUsage,
  type UsageBillingObservation,
} from "./billing-orchestration";
import {
  resolveSubagentUsageAttribution,
  type SubagentUsageAttributionResolver,
} from "./subagent-usage-attribution";
import { normalizeTelemetryBillingRole } from "./telemetry-billing-role";

export type SdkUsageBillingBundle = NonNullable<ReturnType<typeof parseSdkUsageBilling>>;

export interface SdkUsageEventLike {
  id: string;
  role: string;
  payload: unknown;
}

export interface SdkAssistantSubagentBillingInput {
  threadId: string;
  role: AgentRole;
  agentId: string;
  source: "sdk";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  modelId?: string;
  messageId: string;
  runAttemptId?: string;
  plannerAgentId?: string;
  parentToolUseId?: string;
  requestKey: string;
}

export interface SdkStreamPartialUsageInput {
  threadId: string;
  eventId: string;
  role: AgentRole;
  usage: ParsedUsage;
  modelId?: string;
  runAttemptId?: string;
  plannerAgentId?: string;
  subagentAgentId?: string;
  parentToolUseId?: string;
}

export interface SdkRunUsageBillingInput {
  threadId: string;
  role: AgentRole;
  requestKey: string;
  bundle: SdkUsageBillingBundle;
  usagePayload: unknown;
  runAttemptId?: string;
  plannerAgentId?: string;
  subagentAgentId?: string;
  parentToolUseId?: string;
}

export interface SdkUsageDiagnostic {
  throttleKey: string;
  role: AgentRole;
  stream: boolean;
  explicit: boolean;
  subagentAgentId?: string;
  parentToolUseId?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface SdkUsageMissDiagnostic {
  role: AgentRole;
  eventId: string;
  parentToolUseId?: string;
  explicitSubagentId?: string;
}

interface SdkEventUsageResolvedBase {
  bundle: SdkUsageBillingBundle;
  billingRole: AgentRole;
  parentToolUseId?: string;
  explicitSubagentId?: string;
  subagentAgentId?: string;
}

export type SdkEventUsageBillingResolution =
  | { kind: "none" }
  | (SdkEventUsageResolvedBase & {
      kind: "assistant_ignored";
      messageId?: string;
    })
  | (SdkEventUsageResolvedBase & {
      kind: "assistant_subagent";
      messageId: string;
      billingInput: SdkAssistantSubagentBillingInput;
    })
  | (SdkEventUsageResolvedBase & {
      kind: "stream_partial";
      diagnostic: SdkUsageDiagnostic;
      streamInput: SdkStreamPartialUsageInput;
    })
  | (SdkEventUsageResolvedBase & {
      kind: "sdk_run";
      diagnostic: SdkUsageDiagnostic;
      missDiagnostic?: SdkUsageMissDiagnostic;
      runInput: SdkRunUsageBillingInput;
    });

export interface ResolveSdkEventUsageBillingInput {
  threadId: string;
  event: SdkUsageEventLike;
  runAttemptId?: string;
  plannerAgentId?: string;
  resolver: SubagentUsageAttributionResolver;
  observedAuthoritativeUsage?: readonly UsageBillingObservation[];
}

export function resolveSdkEventUsageBilling(
  input: ResolveSdkEventUsageBillingInput,
): SdkEventUsageBillingResolution {
  const { threadId, event } = input;
  const bundle = parseSdkUsageBilling(event.payload);
  if (!bundle) {
    return { kind: "none" };
  }

  const parentToolUseId = readStringProperty(event.payload, "parent_tool_use_id");
  const explicitSubagentId = readStringProperty(event.payload, "subagentAgentId");
  const initialBillingRole = normalizeTelemetryBillingRole(event.role);
  const attribution = resolveSubagentUsageAttribution({
    threadId,
    role: initialBillingRole,
    resolver: input.resolver,
    ...(explicitSubagentId && { explicitSubagentId }),
    ...(parentToolUseId && { parentToolUseId }),
  });
  const { billingRole, subagentAgentId } = attribution;
  const base = {
    bundle,
    billingRole,
    ...(parentToolUseId && { parentToolUseId }),
    ...(explicitSubagentId && { explicitSubagentId }),
    ...(subagentAgentId && { subagentAgentId }),
  };

  if (!bundle.authoritative) {
    return resolveAssistantSubagentBilling({
      threadId,
      bundle,
      billingRole,
      eventPayload: event.payload,
      ...(subagentAgentId && { subagentAgentId }),
      ...(parentToolUseId && { parentToolUseId }),
      ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
      ...(input.plannerAgentId && { plannerAgentId: input.plannerAgentId }),
      ...(input.observedAuthoritativeUsage && {
        observedAuthoritativeUsage: input.observedAuthoritativeUsage,
      }),
      base,
    });
  }

  const stream = isSdkIncrementalStreamUsage(bundle.authoritative, event.payload);
  const diagnostic = buildUsageDiagnostic({
    threadId,
    billingRole,
    bundle,
    stream,
    ...(explicitSubagentId && { explicitSubagentId }),
    ...(subagentAgentId && { subagentAgentId }),
    ...(parentToolUseId && { parentToolUseId }),
  });

  if (stream) {
    return {
      kind: "stream_partial",
      ...base,
      diagnostic,
      streamInput: buildStreamPartialInput({
        threadId,
        event,
        bundle,
        billingRole,
        ...(subagentAgentId && { subagentAgentId }),
        ...(parentToolUseId && { parentToolUseId }),
        ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
        ...(input.plannerAgentId && { plannerAgentId: input.plannerAgentId }),
      }),
    };
  }

  return {
    kind: "sdk_run",
    ...base,
    diagnostic,
    ...(shouldReportUsageMiss({
      billingRole,
      ...(subagentAgentId && { subagentAgentId }),
    }) && {
      missDiagnostic: {
        role: billingRole,
        eventId: event.id,
        ...(parentToolUseId && { parentToolUseId }),
        ...(explicitSubagentId && { explicitSubagentId }),
      },
    }),
    runInput: {
      threadId,
      role: billingRole,
      requestKey: `sdk-result:${event.id}`,
      bundle,
      usagePayload: event.payload,
      ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
      ...(input.plannerAgentId && { plannerAgentId: input.plannerAgentId }),
      ...(subagentAgentId && { subagentAgentId }),
      ...(parentToolUseId && { parentToolUseId }),
    },
  };
}

function resolveAssistantSubagentBilling(input: {
  threadId: string;
  bundle: SdkUsageBillingBundle;
  billingRole: AgentRole;
  eventPayload: unknown;
  subagentAgentId?: string;
  parentToolUseId?: string;
  runAttemptId?: string;
  plannerAgentId?: string;
  observedAuthoritativeUsage?: readonly UsageBillingObservation[];
  base: SdkEventUsageResolvedBase;
}): Extract<SdkEventUsageBillingResolution, { kind: "assistant_ignored" | "assistant_subagent" }> {
  const messageId = readStringProperty(input.eventPayload, "messageId");
  const primaryModel = input.bundle.models[0];
  const usage = primaryModel?.usage ?? input.bundle.contextUsage;
  if (
    !messageId ||
    !input.subagentAgentId ||
    !shouldBillAssistantSubagentUsage({
      role: input.billingRole,
      messageId,
      agentId: input.subagentAgentId,
      usage,
      ...(primaryModel?.modelId && { modelId: primaryModel.modelId }),
      ...(input.observedAuthoritativeUsage && {
        observedAuthoritativeUsage: input.observedAuthoritativeUsage,
      }),
    })
  ) {
    return {
      kind: "assistant_ignored",
      ...input.base,
      ...(messageId && { messageId }),
    };
  }

  return {
    kind: "assistant_subagent",
    ...input.base,
    messageId,
    billingInput: {
      threadId: input.threadId,
      role: input.billingRole,
      agentId: input.subagentAgentId,
      source: "sdk",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      ...(primaryModel?.modelId && { modelId: primaryModel.modelId }),
      messageId,
      ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
      ...(input.plannerAgentId && { plannerAgentId: input.plannerAgentId }),
      ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
      requestKey: buildAssistantUsageRequestKey(messageId),
    },
  };
}

function buildStreamPartialInput(input: {
  threadId: string;
  event: SdkUsageEventLike;
  bundle: SdkUsageBillingBundle;
  billingRole: AgentRole;
  subagentAgentId?: string;
  parentToolUseId?: string;
  runAttemptId?: string;
  plannerAgentId?: string;
}): SdkStreamPartialUsageInput {
  const modelId = readStringProperty(input.event.payload, "model") ?? input.bundle.models[0]?.modelId;
  const streamContextUsage =
    input.subagentAgentId && modelId
      ? (parseSdkContextUsage(input.event.payload, { subagentModelId: modelId }) ??
        input.bundle.contextUsage)
      : input.bundle.contextUsage;
  return {
    threadId: input.threadId,
    eventId: input.event.id,
    role: input.billingRole,
    usage: streamContextUsage,
    ...(modelId && { modelId }),
    ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
    ...(input.plannerAgentId && { plannerAgentId: input.plannerAgentId }),
    ...(input.subagentAgentId && { subagentAgentId: input.subagentAgentId }),
    ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
  };
}

function buildUsageDiagnostic(input: {
  threadId: string;
  billingRole: AgentRole;
  bundle: SdkUsageBillingBundle;
  stream: boolean;
  explicitSubagentId?: string;
  subagentAgentId?: string;
  parentToolUseId?: string;
}): SdkUsageDiagnostic {
  const usage = input.bundle.models[0]?.usage;
  return {
    throttleKey: `sdk-usage:${input.threadId}:${input.billingRole}`,
    role: input.billingRole,
    stream: input.stream,
    explicit: Boolean(input.explicitSubagentId),
    ...(input.subagentAgentId && { subagentAgentId: input.subagentAgentId }),
    ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
    ...(usage?.inputTokens !== undefined && { inputTokens: usage.inputTokens }),
    ...(usage?.outputTokens !== undefined && { outputTokens: usage.outputTokens }),
  };
}

function shouldReportUsageMiss(input: {
  billingRole: AgentRole;
  subagentAgentId?: string;
}): boolean {
  return isSubagentBillingRole(input.billingRole) && !input.subagentAgentId;
}

function readStringProperty(payload: unknown, key: string): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
