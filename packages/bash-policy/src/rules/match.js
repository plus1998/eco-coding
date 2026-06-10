import { collectCommandSegments, collectPipelines } from "../parser";
export function matchDeny(ast, rules) {
    for (const segment of collectCommandSegments(ast)) {
        if (!segment.program) {
            return { reason: "Empty command is not allowed", matchedRule: "empty_command" };
        }
        const commandRule = rules.commands[segment.program];
        if (!commandRule?.deny) {
            continue;
        }
        for (const denyRule of commandRule.deny) {
            if (matchesDenyRule(segment, denyRule)) {
                return {
                    reason: `${segment.program} with target ${formatDenyTarget(segment, denyRule)} is not allowed`,
                    matchedRule: `${segment.program}:deny`,
                };
            }
        }
    }
    return null;
}
function matchesDenyRule(segment, rule) {
    if (rule.targets && !rule.targets.some((target) => segment.targets.includes(target))) {
        return false;
    }
    if (rule.flags && !rule.flags.every((flag) => segment.flags.includes(flag))) {
        return false;
    }
    if (rule.args && !rule.args.every((arg) => segment.args.includes(arg))) {
        return false;
    }
    if (!rule.targets && !rule.flags && !rule.args) {
        return false;
    }
    return true;
}
function formatDenyTarget(segment, rule) {
    if (rule.targets?.length) {
        const matched = rule.targets.find((target) => segment.targets.includes(target));
        return matched ?? segment.targets.join(" ");
    }
    return segment.targets.join(" ") || segment.raw;
}
export function scoreMatchesRule(segment, program, rules) {
    const commandRule = rules.commands[program];
    if (!commandRule) {
        return segment.hasHeredoc ? 20 : 5;
    }
    let score = commandRule.score ?? 5;
    if (commandRule.scoreWhen) {
        for (const whenRule of commandRule.scoreWhen) {
            if (matchesScoreWhen(segment, whenRule)) {
                score = Math.max(score, whenRule.score);
            }
        }
    }
    return score;
}
function matchesScoreWhen(segment, rule) {
    if (rule.flagsContain && !rule.flagsContain.every((flag) => segment.flags.includes(flag))) {
        return false;
    }
    if (rule.argsContain && !rule.argsContain.some((arg) => segment.args.includes(arg))) {
        return false;
    }
    if (rule.targetsContain &&
        !rule.targetsContain.some((target) => segment.targets.some((value) => value.includes(target)))) {
        return false;
    }
    return Boolean(rule.flagsContain || rule.argsContain || rule.targetsContain);
}
export function scorePipeline(ast, rules) {
    let maxScore = 0;
    for (const pipeline of collectPipelines(ast)) {
        if (pipeline.stages.length < 2) {
            continue;
        }
        const programs = pipeline.stages.map((stage) => stage.program);
        for (const pipelineRule of rules.pipelines) {
            if (matchesPipelinePattern(programs, pipelineRule.pattern)) {
                maxScore = Math.max(maxScore, pipelineRule.score);
            }
        }
    }
    return maxScore;
}
function matchesPipelinePattern(programs, pattern) {
    if (pattern.length < 2) {
        return false;
    }
    const lastProgram = pattern[pattern.length - 1];
    const leadingPrograms = pattern.slice(0, -1);
    if (programs[programs.length - 1] !== lastProgram) {
        return false;
    }
    return leadingPrograms.every((program) => programs.includes(program));
}
