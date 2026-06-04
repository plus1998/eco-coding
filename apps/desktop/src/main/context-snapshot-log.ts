import { isUpstreamLogVerbose } from "./upstream-proxy-log";

export function isContextSnapshotLogEnabled(): boolean {
  const flag = process.env.ECO_CONTEXT_SNAPSHOT_LOG?.trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") {
    return true;
  }
  return isUpstreamLogVerbose();
}

export function logContextSnapshot(phase: string, detail: Record<string, unknown>): void {
  if (!isContextSnapshotLogEnabled()) {
    return;
  }
  const line = JSON.stringify({ phase, ...detail });
  const max = 64_000;
  if (line.length <= max) {
    process.stderr.write(`[eco] context-usage ${line}\n`);
    return;
  }
  process.stderr.write(
    `[eco] context-usage ${JSON.stringify({ phase, truncated: true, length: line.length, preview: line.slice(0, max) })}\n`,
  );
}
