/**
 * PI session mode (agent / plan / ask): tool allowlists, read-only bash policy,
 * and mode-aware wrapping of Eco tool permission handlers.
 */
import type { SdkToolPermissionHandler } from "./ask-user-question.js";
import type { SdkToolPermissionDecision, SdkToolPermissionRequest } from "./claude-agent-sdk.js";
import type { CoreSessionMode } from "./core-runtime.js";
import { PI_MCP_PROXY_TOOL_NAMES } from "./pi-mcp.js";
import { PI_AGENT_TOOL_NAME } from "./pi-subagent.js";

export const PI_FINALIZE_PLAN_TOOL_NAME = "finalize_plan" as const;

export const PI_READ_ONLY_BUILTIN_TOOLS = ["read", "grep", "find", "ls", "bash"] as const;
export const PI_WRITE_BUILTIN_TOOLS = ["edit", "write"] as const;

const PI_ASK_PLAN_DENY_TOOLS = new Set(
  [
    ...PI_WRITE_BUILTIN_TOOLS,
    "Edit",
    "Write",
    "MultiEdit",
    "NotebookEdit",
    PI_AGENT_TOOL_NAME,
    "Agent",
  ].map((name) => name.toLowerCase()),
);

const PI_ASK_PLAN_ALLOW_TOOLS = new Set(
  [
    ...PI_READ_ONLY_BUILTIN_TOOLS,
    "Read",
    "Grep",
    "Glob",
    "LS",
    "Find",
    PI_FINALIZE_PLAN_TOOL_NAME,
  ].map((name) => name.toLowerCase()),
);

/** Destructive / mutating patterns — fail closed if matched. */
const DESTRUCTIVE_BASH_PATTERNS: readonly RegExp[] = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bchgrp\b/i,
  /\bln\b/i,
  /\btee\b/i,
  /\btruncate\b/i,
  /\bdd\b/i,
  /\bshred\b/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\$\(/,
  /`/,
  /\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
  /\byarn\s+(add|remove|install|publish)/i,
  /\bpnpm\s+(add|remove|install|publish)/i,
  /\bbun\s+(add|install|remove|publish)/i,
  /\bpip\s+(install|uninstall)/i,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bkill\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\breboot\b/i,
  /\bshutdown\b/i,
  /\b(vim?|nano|emacs|code|subl)\b/i,
];

/** Safe read-only command prefixes (whole command must match one). */
const SAFE_BASH_PATTERNS: readonly RegExp[] = [
  /^\s*cat\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*less\b/,
  /^\s*more\b/,
  /^\s*grep\b/,
  /^\s*find\b/,
  /^\s*ls\b/,
  /^\s*pwd\b/,
  /^\s*echo\b/,
  /^\s*printf\b/,
  /^\s*wc\b/,
  /^\s*sort\b/,
  /^\s*uniq\b/,
  /^\s*diff\b/,
  /^\s*file\b/,
  /^\s*stat\b/,
  /^\s*du\b/,
  /^\s*df\b/,
  /^\s*tree\b/,
  /^\s*which\b/,
  /^\s*whereis\b/,
  /^\s*type\b/,
  /^\s*env\b/,
  /^\s*printenv\b/,
  /^\s*uname\b/,
  /^\s*whoami\b/,
  /^\s*id\b/,
  /^\s*date\b/,
  /^\s*uptime\b/,
  /^\s*ps\b/,
  /^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
  /^\s*git\s+ls-/i,
  /^\s*npm\s+(list|ls|view|info|search|outdated|audit)\b/i,
  /^\s*yarn\s+(list|info|why|audit)\b/i,
  /^\s*node\s+--version\b/i,
  /^\s*python(?:3)?\s+--version\b/i,
  /^\s*bun\s+--version\b/i,
  /^\s*jq\b/,
  /^\s*sed\s+-n\b/i,
  /^\s*awk\b/,
  /^\s*rg\b/,
  /^\s*fd\b/,
  /^\s*bat\b/,
  /^\s*eza\b/,
];

export function isPiReadOnlyBashCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }
  // Fail closed on shell chaining / backgrounding.
  if (/[;&]|\|\||&&/.test(trimmed)) {
    return false;
  }
  if (DESTRUCTIVE_BASH_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return false;
  }
  if (trimmed.includes("|")) {
    const segments = trimmed.split("|").map((part) => part.trim());
    return segments.every(
      (segment) =>
        segment.length > 0 &&
        !DESTRUCTIVE_BASH_PATTERNS.some((pattern) => pattern.test(segment)) &&
        SAFE_BASH_PATTERNS.some((pattern) => pattern.test(segment)),
    );
  }
  return SAFE_BASH_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function piToolsForSessionMode(
  mode: CoreSessionMode,
  options?: { hasMcpServers?: boolean; includeFinalizePlan?: boolean },
): string[] {
  if (mode === "agent") {
    const base = ["read", "bash", "edit", "write"];
    return options?.hasMcpServers ? [...base, ...PI_MCP_PROXY_TOOL_NAMES] : base;
  }
  const tools: string[] = [...PI_READ_ONLY_BUILTIN_TOOLS];
  if (mode === "plan" && options?.includeFinalizePlan !== false) {
    tools.push(PI_FINALIZE_PLAN_TOOL_NAME);
  }
  return tools;
}

export function piSystemPromptForSessionMode(mode: CoreSessionMode): string {
  if (mode === "ask") {
    return [
      "You are PI in Eco Coding Ask mode (read-only exploration).",
      "You may use read, grep, find, ls, and read-only bash commands to inspect the codebase.",
      "You MUST NOT modify files, create files, or run mutating shell commands.",
      "Answer clearly and concisely. Prefer specialized search tools over bash when possible.",
    ].join(" ");
  }
  if (mode === "plan") {
    return [
      "You are PI in Eco Coding Plan mode (read-only planning).",
      "Explore with read, grep, find, ls, and read-only bash only — no file edits or mutating commands.",
      "When ready, submit the full implementation plan by calling the finalize_plan tool with the complete Markdown plan.",
      "Do not attempt to implement changes until the user approves the plan in Eco.",
    ].join(" ");
  }
  return "You are PI running inside Eco Coding. Use read/write/edit/bash tools to fulfill the user's request. Be concise.";
}

export type PiAwaitPlanApproval = (request: {
  toolUseId: string;
  plan: string;
  analysis?: string;
  planFilePath?: string;
  rawInput?: Record<string, unknown>;
}) => Promise<"approved" | "denied">;

export interface CreatePiModeAwareToolPermissionHandlerInput {
  mode: CoreSessionMode;
  baseHandler: SdkToolPermissionHandler;
  awaitPlanApproval?: PiAwaitPlanApproval;
}

function deny(message: string, interrupt = true): SdkToolPermissionDecision {
  return { behavior: "deny", message, interrupt };
}

function allow(input: Record<string, unknown>): SdkToolPermissionDecision {
  return { behavior: "allow", updatedInput: input };
}

function readBashCommand(input: Record<string, unknown>): string {
  const command = input.command;
  return typeof command === "string" ? command : "";
}

function readFinalizePlanText(input: Record<string, unknown>): string {
  const plan = input.plan ?? input.planMarkdown ?? input.content;
  return typeof plan === "string" ? plan.trim() : "";
}

/**
 * Wrap Eco's PI tool permission handler with Ask/Plan hard gates.
 * Agent mode is a pure passthrough to baseHandler.
 */
export function createPiModeAwareToolPermissionHandler(
  input: CreatePiModeAwareToolPermissionHandlerInput,
): SdkToolPermissionHandler {
  const { mode, baseHandler, awaitPlanApproval } = input;
  if (mode === "agent") {
    return baseHandler;
  }

  return async (request: SdkToolPermissionRequest): Promise<SdkToolPermissionDecision> => {
    const toolKey = request.toolName.trim().toLowerCase();

    if (toolKey === PI_FINALIZE_PLAN_TOOL_NAME) {
      if (mode !== "plan") {
        return deny("finalize_plan is only available in Plan mode.");
      }
      if (!awaitPlanApproval) {
        return deny("Eco plan approval is not configured for this PI Plan session.");
      }
      const plan = readFinalizePlanText(request.input);
      if (!plan) {
        return deny("finalize_plan requires a non-empty plan Markdown string.");
      }
      const decision = await awaitPlanApproval({
        toolUseId: request.toolUseId,
        plan,
        analysis: "PI Plan mode submitted this plan via finalize_plan.",
        rawInput: request.input,
      });
      if (decision === "approved") {
        return allow(request.input);
      }
      return deny("User declined the plan in Eco.", false);
    }

    if (PI_ASK_PLAN_DENY_TOOLS.has(toolKey)) {
      return deny(`PI ${mode} mode forbids tool "${request.toolName}".`);
    }

    if (toolKey === "bash") {
      const command = readBashCommand(request.input);
      if (!isPiReadOnlyBashCommand(command)) {
        return deny(
          `PI ${mode} mode blocked non-read-only bash command. Use read/grep/find/ls or an allowlisted read-only command.\nCommand: ${command}`,
        );
      }
      return allow(request.input);
    }

    if (PI_ASK_PLAN_ALLOW_TOOLS.has(toolKey)) {
      return allow(request.input);
    }

    // Unknown / MCP / extension tools: fail closed in Ask/Plan.
    return deny(`PI ${mode} mode blocks unreviewed tool "${request.toolName}".`);
  };
}
