import type { RuntimeRoute } from "./billing-resolver";
import type { UsageBillingPricingLookup } from "./usage-billing-artifacts";

export interface BillingRuntimeEnvironment {
  waitUntilReady(): Promise<void>;
  resolveRuntimeRoutes(threadId: string): readonly RuntimeRoute[];
  lookupPricing: UsageBillingPricingLookup;
}

export interface BillingRuntimeContext {
  runtimeRoutes: readonly RuntimeRoute[];
  lookupPricing: UsageBillingPricingLookup;
}

export interface CreateBillingRuntimeEnvironmentInput {
  waitUntilReady: () => Promise<void>;
  resolveRuntimeRoutes: (threadId: string) => readonly RuntimeRoute[];
  lookupPricing: UsageBillingPricingLookup;
}

export function createBillingRuntimeEnvironment(
  input: CreateBillingRuntimeEnvironmentInput,
): BillingRuntimeEnvironment {
  return {
    waitUntilReady: input.waitUntilReady,
    resolveRuntimeRoutes: input.resolveRuntimeRoutes,
    lookupPricing: input.lookupPricing,
  };
}

export async function resolveBillingRuntimeContext(
  environment: BillingRuntimeEnvironment,
  threadId: string,
): Promise<BillingRuntimeContext> {
  await environment.waitUntilReady();
  return {
    runtimeRoutes: environment.resolveRuntimeRoutes(threadId),
    lookupPricing: environment.lookupPricing,
  };
}
