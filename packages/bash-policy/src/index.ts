export { evaluateBashPolicy } from "./evaluate";
export { parseShellCommand, collectCommandSegments, collectPipelines } from "./parser";
export { DEFAULT_BASH_POLICY_RULES } from "./rules/default";
export { matchDeny, scorePipeline } from "./rules/match";
export { scoreShellAst, riskLevelFromScore, AUTO_APPROVAL_SCORE_THRESHOLD } from "./scorer";
export { matchesAnyCommandPattern } from "./pattern-match";
export { isInsidePath } from "./path-utils";
export type {
  AgentBashPolicy,
  BashPolicyAction,
  BashPolicyDecision,
  BashPolicyInput,
  BashPolicyRules,
  BashReviewMode,
  CommandSegment,
  CompoundSegment,
  PipelineNode,
  ShellAst,
} from "./types";
