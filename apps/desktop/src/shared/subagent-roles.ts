/** Fixed Chinese labels for sub-agent roles in activity cards and context UI. */
export const SUBAGENT_ROLE_SHORT: Record<string, string> = {
  explore: "探索",
  architect: "架构",
  coder: "编码",
  reviewer: "审查",
  tester: "测试",
};

export const SUBAGENT_ROLES = new Set(Object.keys(SUBAGENT_ROLE_SHORT));

export function isSubagentDisplayRole(role?: string): boolean {
  return Boolean(role && SUBAGENT_ROLES.has(role));
}

export function resolveSubagentRunDisplayTitle(role: string): string {
  if (SUBAGENT_ROLE_SHORT[role]) {
    return SUBAGENT_ROLE_SHORT[role];
  }
  return isSubagentDisplayRole(role) ? role : "子代理";
}
