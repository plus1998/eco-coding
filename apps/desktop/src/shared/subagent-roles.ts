import { isSubagentRole, normalizeSdkSubagentType } from "@eco/runtime";

/** Fixed Chinese labels for sub-agent roles in activity cards and context UI. */
export const SUBAGENT_ROLE_SHORT: Record<string, string> = {
  explore: "探索",
  architect: "架构",
  coder: "编码",
  reviewer: "审查",
  tester: "测试",
};

export const SUBAGENT_ROLES = new Set(Object.keys(SUBAGENT_ROLE_SHORT));

const CHINESE_ROLE_TO_ID: Record<string, string> = {
  探索: "explore",
  架构: "architect",
  编码: "coder",
  审查: "reviewer",
  测试: "tester",
};

export function isSubagentDisplayRole(role?: string): boolean {
  return Boolean(role && SUBAGENT_ROLES.has(role));
}

/** Map tool lines / mission payloads to canonical Eco sub-agent role ids. */
export function normalizeSubagentDisplayRole(role: string | undefined): string | undefined {
  if (!role?.trim()) {
    return undefined;
  }
  const trimmed = role.trim();
  const fromChinese = CHINESE_ROLE_TO_ID[trimmed];
  if (fromChinese) {
    return fromChinese;
  }
  const fromSdk = normalizeSdkSubagentType(trimmed);
  if (fromSdk) {
    return fromSdk;
  }
  return isSubagentRole(trimmed) ? trimmed : undefined;
}

export function resolveSubagentRunDisplayTitle(role: string): string {
  const normalized = normalizeSubagentDisplayRole(role) ?? role;
  if (SUBAGENT_ROLE_SHORT[normalized]) {
    return SUBAGENT_ROLE_SHORT[normalized];
  }
  return isSubagentDisplayRole(normalized) ? normalized : "子代理";
}
