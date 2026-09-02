import type { BashPolicyRules, CommandSegment, DenyMatch, ShellAst } from "../types";
export declare function matchDeny(ast: ShellAst, rules: BashPolicyRules): DenyMatch | null;
export declare function scoreMatchesRule(
  segment: CommandSegment,
  program: string,
  rules: BashPolicyRules,
): number;
export declare function scorePipeline(ast: ShellAst, rules: BashPolicyRules): number;
