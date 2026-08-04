import type { ProviderConfigView } from "../shared/ipc";
import type { ComposerModelOption } from "./ComposerModelSelector";

export type ComposerModelAvailabilityState = "ready" | "no-provider" | "no-orchestration";

export function resolveComposerModelAvailability(
  providers: readonly Pick<ProviderConfigView, "enabled">[],
  templateMainModel: ComposerModelOption | undefined,
): ComposerModelAvailabilityState {
  const hasEnabledProvider = providers.some((provider) => provider.enabled);
  if (!hasEnabledProvider) {
    return "no-provider";
  }
  if (!templateMainModel) {
    return "no-orchestration";
  }
  return "ready";
}
