import type { RuntimeAgentRole } from "../shared/ipc";
import { logEcoDiag, shortAgentId, shortThreadId } from "./eco-diag-log";
import type { SubagentAgentResolveMissReason } from "./subagent-agent-resolver";

export type SubagentMetricsDiagnosticLog = (topic: string, fields: Record<string, unknown>) => void;

export interface SubagentMetricsLifecycleDiagnosticInput {
  threadId: string;
  event: "start" | "stop";
  role: RuntimeAgentRole;
  agentId: string;
  activeCount: number;
  toolUseLinks?: number;
}

export interface SubagentMetricsTaskToolDiagnosticInput {
  threadId: string;
  toolUseId: string;
  role?: RuntimeAgentRole;
  pending: boolean;
  pendingCount: number;
}

export interface SubagentMetricsResolveMissDiagnosticInput {
  threadId: string;
  role: RuntimeAgentRole;
  reason: SubagentAgentResolveMissReason;
  parentToolUseId?: string;
  activeAgentIds?: readonly string[];
  mappedParents: number;
}

export interface SubagentMetricsUsageDedupeDiagnosticInput {
  threadId: string;
  role: RuntimeAgentRole;
  agentId: string;
  requestKey: string;
  modelId?: string;
}

export interface SubagentMetricsDiagnosticsPort {
  logLifecycle(input: SubagentMetricsLifecycleDiagnosticInput): void;
  logTaskTool(input: SubagentMetricsTaskToolDiagnosticInput): void;
  logResolveMiss(input: SubagentMetricsResolveMissDiagnosticInput): void;
  logUsageDedupe(input: SubagentMetricsUsageDedupeDiagnosticInput): void;
}

export class SubagentMetricsDiagnostics implements SubagentMetricsDiagnosticsPort {
  constructor(private readonly logDiag: SubagentMetricsDiagnosticLog = logEcoDiag) {}

  logLifecycle(input: SubagentMetricsLifecycleDiagnosticInput): void {
    this.logDiag("subagent.lifecycle", {
      threadId: shortThreadId(input.threadId),
      event: input.event,
      role: input.role,
      agentId: shortAgentId(input.agentId),
      activeCount: input.activeCount,
      ...(input.toolUseLinks !== undefined && { toolUseLinks: input.toolUseLinks }),
    });
  }

  logTaskTool(input: SubagentMetricsTaskToolDiagnosticInput): void {
    this.logDiag("subagent.task_tool", {
      threadId: shortThreadId(input.threadId),
      toolUseId: input.toolUseId.slice(-12),
      ...(input.role && { role: input.role }),
      pending: input.pending,
      pendingCount: input.pendingCount,
    });
  }

  logResolveMiss(input: SubagentMetricsResolveMissDiagnosticInput): void {
    this.logDiag("subagent.resolve_miss", {
      threadId: shortThreadId(input.threadId),
      role: input.role,
      reason: input.reason,
      parentToolUseId: input.parentToolUseId?.slice(-12),
      activeAgents: (input.activeAgentIds ?? []).map(shortAgentId),
      mappedParents: input.mappedParents,
    });
  }

  logUsageDedupe(input: SubagentMetricsUsageDedupeDiagnosticInput): void {
    this.logDiag("subagent.usage_dedupe", {
      threadId: shortThreadId(input.threadId),
      role: input.role,
      agentId: shortAgentId(input.agentId),
      requestKey: input.requestKey,
      modelId: input.modelId,
    });
  }
}

export const defaultSubagentMetricsDiagnostics = new SubagentMetricsDiagnostics();
