import type { EcoCommandRisk, EcoDeviceCapability } from "./event-rpc";

export type RemoteCommandArgKind = "any" | "array" | "boolean" | "number" | "object" | "string";

export interface RemoteCommandArgSchema {
  kind: RemoteCommandArgKind;
  requiredKeys?: readonly string[];
}

export interface RemoteCommandDefinition {
  channel: string;
  title: string;
  risk: EcoCommandRisk;
  requiredCapabilities: readonly EcoDeviceCapability[];
  requiresConfirmation: boolean;
  auditAction: string;
  args: readonly RemoteCommandArgSchema[];
}

export interface RemoteCommandArgsValidation {
  ok: boolean;
  message?: string;
}

const RPC_INVOKE = ["rpc:invoke"] as const;
const APPROVAL_DECIDE = ["rpc:invoke", "approval:decide"] as const;

export const REMOTE_COMMAND_DEFINITIONS = [
  command("thread:list", "List threads", "read", RPC_INVOKE, []),
  command("thread:start", "Start thread", "execute", RPC_INVOKE, [
    objectArg(["workspacePath", "prompt", "runtimeConfig"]),
  ]),
  command("thread:continue", "Continue thread", "execute", RPC_INVOKE, [objectArg(["threadId", "prompt"])]),
  command("thread:cancel", "Cancel thread", "execute", RPC_INVOKE, [stringArg()]),
  command("thread:retry", "Retry thread", "execute", RPC_INVOKE, [stringArg()]),
  command("thread:activity-list", "List thread activity", "read", RPC_INVOKE, [stringArg()]),
  command("thread:get-pending-plan", "Get pending plan", "read", RPC_INVOKE, [stringArg()]),
  command("thread:approve-plan", "Approve pending plan", "privileged", APPROVAL_DECIDE, [
    objectArg(["threadId"]),
  ]),
  command("thread:dismiss-plan", "Dismiss pending plan", "privileged", APPROVAL_DECIDE, [stringArg()]),
  command("thread:follow-up-list", "List follow-ups", "read", RPC_INVOKE, [stringArg()]),
  command("thread:follow-up-enqueue", "Enqueue follow-up", "execute", RPC_INVOKE, [
    objectArg(["threadId", "prompt"]),
  ]),
  command("thread:follow-up-cancel", "Cancel follow-up", "write_safe", RPC_INVOKE, [
    objectArg(["threadId", "followUpId"]),
  ]),
  command("thread:update-runtime-config", "Update thread runtime config", "write_safe", RPC_INVOKE, [
    objectArg(["threadId", "runtimeConfig"]),
  ]),

  command("bash-approval:get-pending", "Get pending bash approval", "read", RPC_INVOKE, [stringArg()]),
  command("bash-approval:resolve", "Resolve bash approval", "privileged", APPROVAL_DECIDE, [
    objectArg(["toolUseId", "decision"]),
  ]),

  command("clarification:get-pending", "Get pending clarification", "read", RPC_INVOKE, [stringArg()]),
  command("clarification:submit", "Submit clarification", "write_safe", RPC_INVOKE, [
    objectArg(["toolUseId", "selections"]),
  ]),
  command("clarification:dismiss", "Dismiss clarification", "write_safe", RPC_INVOKE, [stringArg()]),

  command("workspace:get-current", "Get current workspace", "read", RPC_INVOKE, []),
  command("workspace:inspect", "Inspect workspace", "read", RPC_INVOKE, [stringArg()]),

  command("model-settings:get", "Get model settings", "read", RPC_INVOKE, []),
  command("workflow-settings:get", "Get workflow settings", "read", RPC_INVOKE, []),
  command("workflow-settings:save", "Save workflow settings", "write_safe", RPC_INVOKE, [
    objectArg(["planModeEnabled"]),
  ]),
] as const satisfies readonly RemoteCommandDefinition[];

const REMOTE_COMMANDS_BY_CHANNEL = new Map(
  REMOTE_COMMAND_DEFINITIONS.map((definition) => [definition.channel, definition]),
);

export function listRemoteCommandDefinitions(): readonly RemoteCommandDefinition[] {
  return REMOTE_COMMAND_DEFINITIONS;
}

export function getRemoteCommandDefinition(channel: string): RemoteCommandDefinition | undefined {
  return REMOTE_COMMANDS_BY_CHANNEL.get(channel);
}

export function isRemoteCommandChannel(channel: string): boolean {
  return REMOTE_COMMANDS_BY_CHANNEL.has(channel);
}

export function validateRemoteCommandArgs(
  channel: string,
  args: unknown[] | undefined,
): RemoteCommandArgsValidation {
  const definition = getRemoteCommandDefinition(channel);
  if (!definition) {
    return { ok: false, message: `Remote command is not registered: ${channel}` };
  }
  const actualArgs = args ?? [];
  if (actualArgs.length !== definition.args.length) {
    return {
      ok: false,
      message: `Remote command ${channel} expects ${definition.args.length} args, got ${actualArgs.length}.`,
    };
  }
  for (const [index, schema] of definition.args.entries()) {
    const value = actualArgs[index];
    if (!matchesArgSchema(value, schema)) {
      return {
        ok: false,
        message: `Remote command ${channel} arg ${index + 1} must be ${schema.kind}.`,
      };
    }
    if (schema.kind === "object" && schema.requiredKeys) {
      const record = value as Record<string, unknown>;
      const missingKey = schema.requiredKeys.find((key) => !(key in record));
      if (missingKey) {
        return {
          ok: false,
          message: `Remote command ${channel} arg ${index + 1} is missing ${missingKey}.`,
        };
      }
    }
  }
  return { ok: true };
}

function command(
  channel: string,
  title: string,
  risk: EcoCommandRisk,
  requiredCapabilities: readonly EcoDeviceCapability[],
  args: readonly RemoteCommandArgSchema[],
): RemoteCommandDefinition {
  return {
    channel,
    title,
    risk,
    requiredCapabilities,
    requiresConfirmation: risk === "privileged",
    auditAction: channel.replace(/[:_-]+/g, "."),
    args,
  };
}

function stringArg(): RemoteCommandArgSchema {
  return { kind: "string" };
}

function objectArg(requiredKeys: readonly string[]): RemoteCommandArgSchema {
  return { kind: "object", requiredKeys };
}

function matchesArgSchema(value: unknown, schema: RemoteCommandArgSchema): boolean {
  switch (schema.kind) {
    case "any":
      return true;
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    case "string":
      return typeof value === "string";
  }
}
