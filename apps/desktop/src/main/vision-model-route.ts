import type { VisionModelSelection } from "../shared/vision-model";
import { resolveUpstreamApiCompat } from "../shared/api-compat";
import type { RuntimeRoute } from "./billing-resolver";
import type { ProviderStore } from "./provider-store";

export function resolveVisionModelRoute(
  selection: VisionModelSelection | undefined,
  providerStore: ProviderStore,
): RuntimeRoute {
  if (!selection) {
    throw new Error("未配置视觉模型。请在 Composer 的编排设置中选择视觉模型，或保持未配置以使用主模型。");
  }
  const provider = providerStore
    .listProvidersWithSecrets()
    .find((candidate) => candidate.id === selection.providerId && candidate.enabled);
  if (!provider) {
    throw new Error(`视觉模型所属 Provider 不存在或已禁用：${selection.providerId}`);
  }
  const candidate = providerStore
    .listCandidateModels(provider.id)
    .find((model) => model.id === selection.candidateModelId);
  if (!candidate) {
    throw new Error(`视觉模型已不在候选模型列表中：${selection.candidateModelId}`);
  }
  if (candidate.modelId.trim() !== selection.modelId.trim()) {
    throw new Error(
      `视觉模型配置已发生变化：预期 ${selection.modelId}，当前 ${candidate.modelId}。请重新选择。`,
    );
  }
  return {
    role: "vision",
    provider,
    modelId: candidate.modelId,
    apiCompat: resolveUpstreamApiCompat(undefined, provider.apiCompat),
    ...(candidate.manualSpec ? { manualSpec: candidate.manualSpec } : {}),
    ...(candidate.modelsDevMapping ? { modelsDevMapping: candidate.modelsDevMapping } : {}),
  };
}
