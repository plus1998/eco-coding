/**
 * Maps Eco Composer `sessionMode` + orchestration tool policy to Codex `turn/start` params.
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
  /** Orchestration instructions appended to the Core-native prompt. */
  orchestrationAppend?: string;
  /** Orchestration mainAgent.tools (Codex-native). Defaults to product workspace-write policy. */
  orchestrationToolPolicy?: EcoToolPolicy;
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

function resolveCustomDeveloperInstructions(orchestrationAppend?: string): string {
  return orchestrationAppend?.trim() ?? "";
}

/**
 * Build Codex `turn/start` options from Eco thread runtime config.
 *
 * Codex ships base instructions; Eco only forwards the orchestration's custom main-agent prompt
 * when `systemPromptPreset === "custom_append"`.
 *
 * | sessionMode | collaborationMode | sandboxPolicy (before orchestration intersect) |
 * |-------------|-------------------|------------------------------------------|
 * | agent       | default           | orchestration (default workspace-write)  |
 * | plan        | plan              | workspaceWrite unless orchestration is read-only |
 * | ask         | default           | readOnly                                 |
 */
export function buildCodexTurnOptions(config: CodexTurnMaterializationConfig): CodexTurnOptions {
  const developerInstructions = resolveCustomDeveloperInstructions(config.orchestrationAppend);
  const hasDeveloperInstructions = developerInstructions.length > 0;
  const orchestrationToolPolicy = config.orchestrationToolPolicy ?? DEFAULT_CODEX_TOOL_POLICY;
  const effective = resolveEffectiveTurnSandbox({
    sessionMode: config.sessionMode,
    orchestrationPolicy: orchestrationToolPolicy,
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
