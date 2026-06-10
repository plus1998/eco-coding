import { parseShellCommand } from "./parser";
import { matchesAnyCommandPattern } from "./pattern-match";
import { isInsidePath } from "./path-utils";
import { DEFAULT_BASH_POLICY_RULES } from "./rules/default";
import { matchDeny } from "./rules/match";
import { AUTO_APPROVAL_SCORE_THRESHOLD, riskLevelFromScore, scoreShellAst } from "./scorer";
import type { BashPolicyDecision, BashPolicyInput, BashPolicyRules, BashReviewMode } from "./types";

export function evaluateBashPolicy(
  input: BashPolicyInput,
  rules: BashPolicyRules = DEFAULT_BASH_POLICY_RULES,
): BashPolicyDecision {
  const command = input.command.trim();
  if (!command) {
    return denyDecision(100, "Empty command is not allowed", "empty_command");
  }

  const agentBash = input.agentBash;
  if (agentBash?.enabled === false) {
    return denyDecision(100, "Bash is disabled for this Eco agent.", "bash_disabled");
  }

  if (agentBash?.commandDenylist?.length && matchesAnyCommandPattern(command, agentBash.commandDenylist)) {
    return denyDecision(100, "Bash command is denied by this Eco agent command denylist.", "agent_denylist");
  }

  const commandAllowlist = agentBash?.commandAllowlist ?? [];
  if (commandAllowlist.length > 0 && !matchesAnyCommandPattern(command, commandAllowlist)) {
    return denyDecision(100, "Bash command is outside this Eco agent command allowlist.", "agent_allowlist");
  }

  if (rules.workspace.denyOutsideCwd && !isInsidePath(input.cwd, input.workspacePath)) {
    return denyDecision(100, "Command cwd is outside the workspace", "cwd_outside_workspace");
  }

  const ast = parseShellCommand(command);
  const denyMatch = matchDeny(ast, rules);
  if (denyMatch) {
    return denyDecision(100, denyMatch.reason, denyMatch.matchedRule);
  }

  const riskScore = scoreShellAst(ast, rules);
  const riskLevel = riskLevelFromScore(riskScore);
  return decideByMode(input.mode, riskScore, riskLevel);
}

function decideByMode(
  mode: BashReviewMode,
  riskScore: number,
  riskLevel: BashPolicyDecision["riskLevel"],
): BashPolicyDecision {
  if (mode === "allow_all") {
    return {
      action: "allow",
      riskScore,
      riskLevel,
      reason: "Command is allowed by allow_all mode",
    };
  }

  if (mode === "auto") {
    if (riskScore > AUTO_APPROVAL_SCORE_THRESHOLD) {
      return {
        action: "ask",
        riskScore,
        riskLevel,
        reason: `Command risk score ${riskScore} exceeds threshold ${AUTO_APPROVAL_SCORE_THRESHOLD}`,
        matchedRule: "auto_threshold",
      };
    }
    return {
      action: "allow",
      riskScore,
      riskLevel,
      reason: "Command is within auto-approval risk threshold",
    };
  }

  return {
    action: "ask",
    riskScore,
    riskLevel,
    reason: "Bash requires user confirmation in always review mode",
    matchedRule: "always_mode",
  };
}

function denyDecision(score: number, reason: string, matchedRule: string): BashPolicyDecision {
  return {
    action: "deny",
    riskScore: score,
    riskLevel: riskLevelFromScore(score),
    reason,
    matchedRule,
  };
}
