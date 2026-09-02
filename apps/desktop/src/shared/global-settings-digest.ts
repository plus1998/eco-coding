import { createHash } from "node:crypto";
import type { ModelSettingsSnapshot, WorkflowSettingsSnapshot } from "./ipc";

export interface GlobalSettingsDigestInput {
  modelSettings: ModelSettingsSnapshot;
  workflowSettings: WorkflowSettingsSnapshot;
}

export interface GlobalSettingsDigestResult {
  digest: string;
}

/**
 * Content digest for Mobile (and other thin clients) to decide whether a full
 * model/workflow settings pull is needed. Secrets are reduced to presence bits.
 */
export function computeGlobalSettingsDigest(input: GlobalSettingsDigestInput): GlobalSettingsDigestResult {
  const payload = {
    modelSettings: input.modelSettings,
    workflowSettings: redactWorkflowSettingsForDigest(input.workflowSettings),
  };
  const digest = createHash("sha256").update(stableSerialize(payload)).digest("hex").slice(0, 32);
  return { digest };
}

export function redactWorkflowSettingsForDigest(workflow: WorkflowSettingsSnapshot): Record<string, unknown> {
  const { acpCursorApiKey, ...rest } = workflow;
  return {
    ...rest,
    hasAcpCursorApiKey: Boolean(acpCursorApiKey?.trim()),
  };
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
