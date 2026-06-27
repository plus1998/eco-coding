import type { ThreadActivityOrigin } from "../shared/thread-activity-origin";

/** Classify SDK stream text at emit time only — not for renderer-side guessing. */
export function classifySdkStreamMessageOrigin(message: string): ThreadActivityOrigin | undefined {
  const trimmed = message.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("Claude Code returned an error result:")) {
    return "sdk.run_failure";
  }
  if (trimmed.startsWith("API Error:")) {
    return "sdk.upstream_error";
  }
  return undefined;
}
