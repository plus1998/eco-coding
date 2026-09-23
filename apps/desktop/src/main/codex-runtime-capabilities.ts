import type { ModelRef } from "../shared/agent-orchestration";
import type { ThreadRuntimeConfig } from "../shared/thread-runtime-config";

export const LONGCAT_CODEX_RESPONSES_ERROR =
  "LongCat-2.0 用于 Codex Core 时必须使用 openai_responses；Chat Completions 不支持 Codex 工具调用。";
export const LONGCAT_CODEX_SUBAGENT_ERROR =
  "LongCat-2.0 当前不支持 Codex 子代理的加密 agent_message；请改用 PI/Claude，或切换到支持 Codex Multi-Agent 的 Responses Provider。";

/** Throw before a Codex run can create a misleading partial V2 history. */
export function assertCodexRuntimeConfigSupported(runtimeConfig: ThreadRuntimeConfig): void {
  const snapshot = runtimeConfig.resolvedOrchestrationSnapshot;
  if (!snapshot) {
    return;
  }

  if (
    isLongCatModelRef(snapshot.mainAgent.modelRef) &&
    snapshot.mainAgent.modelRef.apiCompat !== "openai_responses"
  ) {
    throw new Error(LONGCAT_CODEX_RESPONSES_ERROR);
  }

  const enabledLongCatAgent = snapshot.agents.find(
    (agent) => agent.enabled && isLongCatModelRef(agent.modelRef),
  );
  if (enabledLongCatAgent) {
    throw new Error(LONGCAT_CODEX_SUBAGENT_ERROR);
  }
}

export function isLongCatModelRef(modelRef: ModelRef): boolean {
  return /longcat/i.test(modelRef.providerId) || /longcat/i.test(modelRef.modelId);
}
