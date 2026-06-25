import type { BashPolicyDecision, BashPolicyInput, BashPolicyRules } from "./types";

export declare function evaluateBashHardDeny(
  input: Omit<BashPolicyInput, "mode">,
  rules?: BashPolicyRules,
): BashPolicyDecision | undefined;

export declare function evaluateBashPolicy(
  input: BashPolicyInput,
  rules?: BashPolicyRules,
): BashPolicyDecision;
