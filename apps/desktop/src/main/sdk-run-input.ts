import type {
  AgentRuntimeRunInput,
  EcoSdkResumeOptions,
  EcoSdkSessionOptions,
  ResumableSubagentRef,
  SubagentRunPhase,
  EcoAgentRuntimeConfig,
} from "@eco/runtime";

export type SdkRunMode = "planning" | "execution" | "ask";

export function normalizeSdkRunMode(value: unknown): SdkRunMode | undefined {
  if (value === "question") {
    return "ask";
  }
  if (value === "planning" || value === "execution" || value === "ask") {
    return value;
  }
  return undefined;
}

export interface BuildSdkRunInput {
  threadId: string;
  prompt: string;
  workspacePath: string;
  worktreePath: string;
  routes: AgentRuntimeRunInput["routes"];
  signal: AbortSignal;
  sdkSession?: EcoSdkSessionOptions;
  resume?: EcoSdkResumeOptions;
  resumableSubagents?: readonly ResumableSubagentRef[];
  executionPromptOverride?: string;
  agentRegistry?: EcoAgentRuntimeConfig | undefined;
  globalUserRules?: string;
}

export function buildSdkRunInput(input: BuildSdkRunInput): AgentRuntimeRunInput {
  return {
    threadId: input.threadId,
    prompt: input.prompt,
    workspacePath: input.workspacePath,
    worktreePath: input.worktreePath,
    routes: input.routes,
    signal: input.signal,
    ...(input.sdkSession ? { sdkSession: input.sdkSession } : {}),
    ...(input.resume ? { resume: input.resume } : {}),
    ...(input.resumableSubagents ? { resumableSubagents: input.resumableSubagents } : {}),
    ...(input.executionPromptOverride ? { executionPromptOverride: input.executionPromptOverride } : {}),
    ...(input.agentRegistry ? { agentRegistry: input.agentRegistry } : {}),
    ...(input.globalUserRules?.trim() ? { globalUserRules: input.globalUserRules.trim() } : {}),
  };
}

export function sdkRunPhaseFromMode(mode: SdkRunMode): SubagentRunPhase {
  return mode;
}
