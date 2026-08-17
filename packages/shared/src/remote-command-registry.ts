import type { EcoCommandRisk, EcoDeviceCapability } from "./event-rpc";

export type RemoteCommandArgKind = "any" | "array" | "boolean" | "number" | "object" | "string";

export interface RemoteCommandArgSchema {
  kind: RemoteCommandArgKind;
  requiredKeys?: readonly string[];
  optional?: boolean;
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
  command("thread:get", "Get thread", "read", RPC_INVOKE, [stringArg()]),
  command("thread:session-bootstrap", "Bootstrap thread session", "read", RPC_INVOKE, [stringArg()]),
  command("thread:start", "Start thread", "execute", RPC_INVOKE, [
    objectArg(["workspacePath", "prompt", "runtimeConfig"]),
  ]),
  command("thread:continue", "Continue thread", "execute", RPC_INVOKE, [objectArg(["threadId", "prompt"])]),
  command("thread:cancel", "Cancel thread", "execute", RPC_INVOKE, [stringArg()]),
  command("thread:delete", "Delete thread", "write_safe", RPC_INVOKE, [stringArg()]),
  command("thread:regenerate-title", "Regenerate thread title", "write_safe", RPC_INVOKE, [stringArg()]),
  command("thread:activity-list", "List thread activity", "read", RPC_INVOKE, [stringArg()]),
  command("thread:get-usage-snapshot", "Get thread usage snapshot", "read", RPC_INVOKE, [stringArg()]),
  command("thread:run-projection-get", "Get thread run projection", "read", RPC_INVOKE, [
    stringArg(),
    optionalStringArg(),
  ]),
  command("thread:run-projection-detail-get", "Get thread run projection detail", "read", RPC_INVOKE, [
    objectArg(["threadId", "kind", "key"]),
  ]),
  command("thread:subagent-sessions-list", "List thread subagent sessions", "read", RPC_INVOKE, [
    stringArg(),
  ]),
  command("thread:get-pending-plan", "Get pending plan", "read", RPC_INVOKE, [stringArg()]),
  command("thread:get-approved-plan", "Get approved plan", "read", RPC_INVOKE, [stringArg()]),
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
  command("thread:follow-up-escalate", "Escalate follow-up", "execute", RPC_INVOKE, [
    objectArg(["threadId"]),
  ]),
  command("thread:follow-up-update", "Update follow-up", "write_safe", RPC_INVOKE, [
    objectArg(["threadId", "followUpId", "prompt"]),
  ]),
  command("thread:follow-up-reorder", "Reorder follow-ups", "write_safe", RPC_INVOKE, [
    objectArg(["threadId", "followUpIds"]),
  ]),
  command("thread:update-runtime-config", "Update thread runtime config", "write_safe", RPC_INVOKE, [
    objectArg(["threadId", "runtimeConfig"]),
  ]),
  command("thread:todo-list", "List thread todo progress", "read", RPC_INVOKE, [stringArg()]),

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
  command("workspace:get-home-path", "Get home project path", "read", RPC_INVOKE, []),
  command("workspace:get-user-home-path", "Get desktop user home path", "read", RPC_INVOKE, []),
  command("workspace:list-directories", "List workspace directories", "read", RPC_INVOKE, [stringArg()]),
  command("workspace:open-path", "Open workspace by path", "write_safe", RPC_INVOKE, [stringArg()]),
  command("workspace:inspect", "Inspect workspace", "read", RPC_INVOKE, [stringArg()]),
  command("workspace:list-package-scripts", "List npm scripts", "read", RPC_INVOKE, [stringArg()]),
  command("workspace:save-package-script-args", "Save npm script extra args", "write_safe", RPC_INVOKE, [
    objectArg(["workspacePath", "script", "args"]),
  ]),
  command("workspace:start-package-script", "Start npm script", "execute", RPC_INVOKE, [
    objectArg(["workspacePath", "script"]),
  ]),

  command("background-terminal:open", "Read background terminal task", "read", RPC_INVOKE, [
    objectArg(["taskId"]),
  ]),
  command("background-terminal:stop", "Stop background terminal task", "execute", RPC_INVOKE, [
    objectArg(["taskId"]),
  ]),

  command("model-settings:get", "Get model settings", "read", RPC_INVOKE, []),
  command("cursor:models-list", "List Cursor Agent CLI models", "read", RPC_INVOKE, []),
  command("candidate-model:list", "List candidate models", "read", RPC_INVOKE, [stringArg()]),
  command("mcp-settings:get", "Get MCP settings", "read", RPC_INVOKE, []),
  command("integration-availability:get", "Get integration availability", "read", RPC_INVOKE, []),
  command("skills:list", "List Skills", "read", RPC_INVOKE, [optionalStringArg()]),
  command("project-skills-settings:get", "Get project Skills settings", "read", RPC_INVOKE, [stringArg()]),
  command("project-skills-settings:save", "Save project Skills settings", "write_safe", RPC_INVOKE, [
    objectArg(["workspacePath", "enabledByPath"]),
  ]),
  command("project-integrations-settings:get", "Get project integrations settings", "read", RPC_INVOKE, [
    stringArg(),
  ]),
  command(
    "project-integrations-settings:save",
    "Save project integrations settings",
    "write_safe",
    RPC_INVOKE,
    [objectArg(["workspacePath", "enabled"])],
  ),
  command(
    "project-orchestration-settings:get",
    "Get project orchestration settings",
    "read",
    RPC_INVOKE,
    [stringArg()],
  ),
  command(
    "project-orchestration-settings:save",
    "Save project orchestration settings",
    "write_safe",
    RPC_INVOKE,
    [objectArg(["workspacePath", "orchestrationSelection"])],
  ),
  command("workflow-settings:get", "Get workflow settings", "read", RPC_INVOKE, []),
  command("workflow-settings:save", "Save workflow settings", "write_safe", RPC_INVOKE, [
    objectArg(["sessionMode"]),
  ]),
  command("asr-settings:get-status", "Get ASR settings status", "read", RPC_INVOKE, []),
  command("asr:transcribe", "Transcribe audio", "execute", RPC_INVOKE, [objectArg(["audioWavBase64"])]),
  command("image-view:read", "Read image for image view", "read", RPC_INVOKE, [objectArg(["path"])]),

  command("git:get-status", "Get git working tree status", "read", RPC_INVOKE, [stringArg()]),
  command("git:get-workspace-diff", "Get workspace diff", "read", RPC_INVOKE, [stringArg()]),
  command("git:checkout-branch", "Checkout git branch", "execute", RPC_INVOKE, [
    objectArg(["workspacePath", "branch"]),
  ]),
  command("git:create-branch", "Create git branch", "execute", RPC_INVOKE, [
    objectArg(["workspacePath", "branch"]),
  ]),
  command("git:generate-commit-message", "Generate commit message", "read", RPC_INVOKE, [
    objectArg(["workspacePath", "includeUnstaged"]),
  ]),
  command("git:list-commit-model-options", "List commit message model options", "read", RPC_INVOKE, [
    objectArg([]),
  ]),
  command("git:commit", "Commit workspace changes", "execute", RPC_INVOKE, [
    objectArg(["workspacePath", "includeUnstaged"]),
  ]),
  command("git:push", "Push commits to remote", "execute", RPC_INVOKE, [objectArg(["workspacePath"])]),
  command("git:fetch", "Fetch from remote", "execute", RPC_INVOKE, [objectArg(["workspacePath"])]),
  command("git:pull", "Pull from remote", "execute", RPC_INVOKE, [objectArg(["workspacePath"])]),
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
  const requiredArgCount = definition.args.filter((arg) => !arg.optional).length;
  const maxArgCount = definition.args.length;
  if (actualArgs.length < requiredArgCount || actualArgs.length > maxArgCount) {
    const expected =
      requiredArgCount === maxArgCount ? `${requiredArgCount}` : `${requiredArgCount} to ${maxArgCount}`;
    return {
      ok: false,
      message: `Remote command ${channel} expects ${expected} args, got ${actualArgs.length}.`,
    };
  }
  for (const [index, schema] of definition.args.entries()) {
    if (index >= actualArgs.length) {
      continue;
    }
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

function optionalStringArg(): RemoteCommandArgSchema {
  return { kind: "string", optional: true };
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
