import type { ApprovalRiskLevel } from "../../shared/src";
import type { BashPolicyRules, ShellAst } from "./types";
export declare function scoreShellAst(ast: ShellAst, rules?: BashPolicyRules): number;
export declare function riskLevelFromScore(score: number): ApprovalRiskLevel;
export declare const AUTO_APPROVAL_SCORE_THRESHOLD = 85;
