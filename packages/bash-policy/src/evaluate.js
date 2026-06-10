import { parseShellCommand } from "./parser";
import { matchesAnyCommandPattern } from "./pattern-match";
import { isInsidePath } from "./path-utils";
import { DEFAULT_BASH_POLICY_RULES } from "./rules/default";
import { matchDeny } from "./rules/match";
import { AUTO_APPROVAL_SCORE_THRESHOLD, riskLevelFromScore, scoreShellAst } from "./scorer";
export function evaluateBashPolicy(input, rules = DEFAULT_BASH_POLICY_RULES) {
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
    if ((agentBash?.commandAllowlist?.length ?? 0) > 0 &&
        !matchesAnyCommandPattern(command, agentBash.commandAllowlist ?? [])) {
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
function decideByMode(mode, riskScore, riskLevel) {
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
function denyDecision(score, reason, matchedRule) {
    return {
        action: "deny",
        riskScore: score,
        riskLevel: riskLevelFromScore(score),
        reason,
        matchedRule,
    };
}
