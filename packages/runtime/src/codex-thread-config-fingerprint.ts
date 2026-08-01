import { createHash } from "node:crypto";

const appliedThreadConfigByClient = new WeakMap<object, Map<string, string>>();

export function fingerprintCodexThreadConfig(config: Record<string, unknown>): string {
  return createHash("sha256").update(stableConfigSerialization(config)).digest("hex");
}

export function recordAppliedCodexThreadConfig(
  client: object,
  threadId: string,
  config: Record<string, unknown>,
): void {
  const byThread = appliedThreadConfigByClient.get(client) ?? new Map<string, string>();
  byThread.set(threadId.trim(), fingerprintCodexThreadConfig(config));
  appliedThreadConfigByClient.set(client, byThread);
}

export function getAppliedCodexThreadConfigFingerprint(client: object, threadId: string): string | undefined {
  return appliedThreadConfigByClient.get(client)?.get(threadId.trim());
}

export function isCodexThreadConfigApplied(
  client: object,
  threadId: string,
  config: Record<string, unknown>,
): boolean {
  return getAppliedCodexThreadConfigFingerprint(client, threadId) === fingerprintCodexThreadConfig(config);
}

function stableConfigSerialization(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableConfigSerialization).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableConfigSerialization(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
