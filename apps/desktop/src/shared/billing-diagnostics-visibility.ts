import type { ThreadBillingDiagnostic, ThreadStatus } from "./ipc";

export function isDeferredBillingDiagnostic(diagnostic: ThreadBillingDiagnostic): boolean {
  return (
    diagnostic.type === "projection_missing" ||
    diagnostic.type === "primary_source_mismatch" ||
    diagnostic.type === "token_mismatch" ||
    diagnostic.type === "cost_mismatch" ||
    diagnostic.type === "subagent_metrics_mismatch" ||
    diagnostic.type === "unattributed_usage" ||
    diagnostic.type === "unresolved_usage"
  );
}

export function filterVisibleBillingDiagnostics(
  diagnostics: readonly ThreadBillingDiagnostic[] | undefined,
  threadStatus?: ThreadStatus,
): ThreadBillingDiagnostic[] {
  const hideDeferredDiagnostics = threadStatus === "running" || threadStatus === "queued";
  return (diagnostics ?? []).filter(
    (diagnostic) =>
      diagnostic.severity !== "info" &&
      (!hideDeferredDiagnostics || !isDeferredBillingDiagnostic(diagnostic)),
  );
}
