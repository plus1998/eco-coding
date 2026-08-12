import type { ResolvedModelRoute } from "@eco/model-router";
import type { PromptImageAttachment } from "../shared/ipc";
import type { AnthropicProxyResolvedRoute, StartedAnthropicProxy } from "./anthropic-proxy";
import type { RuntimeRoute } from "./billing-resolver";
import type { RequestAttemptResult } from "./request-retry";
import { buildDriverRoutes, type RuntimeConfigResolution } from "./thread-runtime-routes";

export type ThreadRuntimeProxyResult = RequestAttemptResult & Record<string, unknown>;

export interface ThreadRuntimeProxyAttempt {
  proxy: StartedAnthropicProxy;
  routes: ResolvedModelRoute[];
  plannerRoute?: AnthropicProxyResolvedRoute;
}

export interface RunThreadRequestWithRuntimeProxyInput {
  threadId: string;
  attachments?: PromptImageAttachment[] | undefined;
  resolveRuntimeConfig: () => RuntimeConfigResolution;
  recordRouteFingerprint: (threadId: string, routes: readonly RuntimeRoute[]) => void;
  startRuntimeProxy: (
    routes: RuntimeRoute[],
    attachments: PromptImageAttachment[] | undefined,
    threadId: string,
  ) => Promise<StartedAnthropicProxy>;
  onProxyReady?: (attempt: ThreadRuntimeProxyAttempt) => void | Promise<void>;
  run: (attempt: ThreadRuntimeProxyAttempt) => Promise<ThreadRuntimeProxyResult>;
}

/**
 * Start a per-run proxy, execute the driver, then close.
 * Route fingerprint is recorded AFTER the run so resolveResumeOptions still sees the
 * previous fingerprint while deciding Claude resume for this attempt.
 */
export async function runThreadRequestWithRuntimeProxy(
  input: RunThreadRequestWithRuntimeProxyInput,
): Promise<ThreadRuntimeProxyResult> {
  const freshConfig = input.resolveRuntimeConfig();
  if (!freshConfig.ok) {
    return { ok: false, reason: freshConfig.reason };
  }

  const proxy = await input.startRuntimeProxy(freshConfig.routes, input.attachments, input.threadId);
  try {
    const plannerRoute = proxy.routes.find((route) => route.role === "planner");
    const attempt: ThreadRuntimeProxyAttempt = {
      proxy,
      routes: buildDriverRoutes(proxy.routes),
      ...(plannerRoute && { plannerRoute }),
    };
    await input.onProxyReady?.(attempt);
    const result = await input.run(attempt);
    // Persist after resume decision + run so apiCompat changes are not overwritten first.
    input.recordRouteFingerprint(input.threadId, freshConfig.routes);
    return result;
  } finally {
    await proxy.close();
  }
}
