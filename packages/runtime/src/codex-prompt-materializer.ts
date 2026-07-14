/**
 * Maps Eco Composer `sessionMode` + Profile tool policy to Codex `turn/start` params.
 *
 * @see docs/codex-integration-plan.md §6.2.1, §6.5.1
 * @see docs/codex-permissions.md
 */

import {
  DEFAULT_CODEX_TOOL_POLICY,
  resolveEffectiveTurnSandbox,
  toCodexAppServerSandboxPolicyWire,
  type CodexApprovalPolicy,
  type CodexTurnSandboxPolicy,
  type EcoToolPolicy,
} from "./codex-tool-policy.js";

export const CODEX_SESSION_MODES = ["agent", "plan", "ask"] as const;

export type CodexSessionMode = (typeof CODEX_SESSION_MODES)[number];

export type CodexCollaborationModeKind = "default" | "plan";

/** App-server ReasoningEffort is an arbitrary non-empty string in 0.142.5. */
export type CodexReasoningEffort = string;

export type CodexSandboxPolicy = CodexTurnSandboxPolicy;

export type CodexAppServerSandboxPolicy = ReturnType<typeof toCodexAppServerSandboxPolicyWire>;

export function toCodexAppServerSandboxPolicy(
  policy: CodexSandboxPolicy,
  networkAccess?: boolean,
): CodexAppServerSandboxPolicy {
  return toCodexAppServerSandboxPolicyWire(policy, networkAccess);
}

/**
 * Materializer draft — `settings.model` is applied later from the route
 * (`ResolvedModelRoute.upstreamModelId`) before `turn/start`.
 */
export interface CodexCollaborationModeDraft {
  mode: CodexCollaborationModeKind;
  settings?: {
    developer_instructions?: string;
  };
}

/** Wire format for Codex app-server `collaborationMode` (Settings.model is required). */
export interface CodexCollaborationMode {
  mode: CodexCollaborationModeKind;
  settings: {
    model: string;
    reasoning_effort?: CodexReasoningEffort;
    developer_instructions?: string;
  };
}

export interface CodexTurnMaterializationConfig {
  sessionMode: CodexSessionMode;
  /** Profile custom main-agent prompt only (when systemPromptPreset is custom). */
  profileAppend?: string;
  /** Profile mainAgent.tools (Codex-native). Defaults to product workspace-write policy. */
  profileToolPolicy?: EcoToolPolicy;
}

export interface CodexTurnOptions {
  collaborationMode: CodexCollaborationModeDraft;
  sandboxPolicy: CodexSandboxPolicy;
  /** When sandbox is workspaceWrite / readOnly, optional network_access. */
  networkAccess?: boolean;
  /** Codex `turn/start.approvalPolicy`. */
  approvalPolicy: CodexApprovalPolicy;
  developer_instructions: string;
}

/** Bind ThreadRuntimeConfig / route modelId into collaborationMode.settings.model. */
export function applyCodexTurnModel(
  draft: CodexCollaborationModeDraft,
  model: string,
  reasoningEffort?: CodexReasoningEffort,
): CodexCollaborationMode {
  const turnModel = model.trim();
  if (!turnModel) {
    throw new Error("model is required for Codex collaborationMode.settings.model");
  }
  const normalizedReasoningEffort = reasoningEffort?.trim();
  if (reasoningEffort !== undefined && !normalizedReasoningEffort) {
    throw new Error("reasoning effort must be a non-empty string");
  }
  return {
    mode: draft.mode,
    settings: {
      model: turnModel,
      ...(normalizedReasoningEffort ? { reasoning_effort: normalizedReasoningEffort } : {}),
      ...(draft.settings?.developer_instructions
        ? { developer_instructions: draft.settings.developer_instructions }
        : {}),
    },
  };
}

export function isCodexSessionMode(value: unknown): value is CodexSessionMode {
  return typeof value === "string" && (CODEX_SESSION_MODES as readonly string[]).includes(value);
}

function resolveCustomDeveloperInstructions(profileAppend?: string): string {
  return profileAppend?.trim() ?? "";
}

/**
 * Build Codex `turn/start` options from Eco thread runtime config.
 *
 * Codex ships base instructions; Eco only forwards Profile custom main-agent prompt
 * when `systemPromptPreset === "custom"`.
 *
 * | sessionMode | collaborationMode | sandboxPolicy (before profile intersect) |
 * |-------------|-------------------|------------------------------------------|
 * | agent       | default           | profile (default workspace-write)        |
 * | plan        | plan              | workspaceWrite unless profile read-only  |
 * | ask         | default           | readOnly                                 |
 */
export function buildCodexTurnOptions(config: CodexTurnMaterializationConfig): CodexTurnOptions {
  const developerInstructions = resolveCustomDeveloperInstructions(config.profileAppend);
  const hasDeveloperInstructions = developerInstructions.length > 0;
  const profileToolPolicy = config.profileToolPolicy ?? DEFAULT_CODEX_TOOL_POLICY;
  const effective = resolveEffectiveTurnSandbox({
    sessionMode: config.sessionMode,
    profilePolicy: profileToolPolicy,
  });

  const base = {
    sandboxPolicy: effective.sandboxPolicy,
    ...(effective.networkAccess ? { networkAccess: true } : {}),
    approvalPolicy: effective.approvalPolicy,
    developer_instructions: developerInstructions,
  };

  switch (config.sessionMode) {
    case "plan":
      return {
        collaborationMode: { mode: "plan" },
        ...base,
      };
    case "ask":
      return {
        collaborationMode: {
          mode: "default",
          ...(hasDeveloperInstructions
            ? { settings: { developer_instructions: developerInstructions } }
            : {}),
        },
        ...base,
      };
    case "agent":
    default:
      return {
        collaborationMode: {
          mode: "default",
          ...(hasDeveloperInstructions
            ? { settings: { developer_instructions: developerInstructions } }
            : {}),
        },
        ...base,
      };
  }
}
