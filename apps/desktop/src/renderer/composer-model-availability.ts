import type { CoreKind } from "@eco/runtime/core-runtime";
import type { ProviderConfigView } from "../shared/ipc";
import type { ComposerModelOption } from "./ComposerModelSelector";

export type ComposerModelAvailabilityState = "ready" | "no-provider" | "no-orchestration" | "acp";

export function composerRequiresOrchestration(coreKind: CoreKind): boolean {
  return coreKind !== "acp";
}

export function resolveComposerModelAvailability(
  providers: readonly Pick<ProviderConfigView, "enabled">[],
  templateMainModel: ComposerModelOption | undefined,
  coreKind?: CoreKind,
): ComposerModelAvailabilityState {
  if (coreKind === "acp") {
    return "acp";
  }
  const hasEnabledProvider = providers.some((provider) => provider.enabled);
  if (!hasEnabledProvider) {
    return "no-provider";
  }
  if (!templateMainModel) {
    return "no-orchestration";
  }
  return "ready";
}
