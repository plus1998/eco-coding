import { collectCommandSegments } from "./parser";
import { DEFAULT_BASH_POLICY_RULES } from "./rules/default";
import { scoreMatchesRule, scorePipeline } from "./rules/match";
export function scoreShellAst(ast, rules = DEFAULT_BASH_POLICY_RULES) {
    if (ast.compounds.length === 0) {
        return 100;
    }
    let maxScore = 0;
    for (const segment of collectCommandSegments(ast)) {
        if (!segment.program) {
            return 100;
        }
        const program = normalizeProgram(segment.program);
        maxScore = Math.max(maxScore, scoreMatchesRule(segment, program, rules));
    }
    maxScore = Math.max(maxScore, scorePipeline(ast, rules));
    return Math.min(100, Math.max(0, maxScore));
}
function normalizeProgram(program) {
    const base = program.split("/").pop() ?? program;
    return base;
}
export function riskLevelFromScore(score) {
    if (score >= 85) {
        return "critical";
    }
    if (score >= 61) {
        return "high";
    }
    if (score >= 31) {
        return "medium";
    }
    return "low";
}
export const AUTO_APPROVAL_SCORE_THRESHOLD = 85;
