export type BashApprovalChoice =
  | "approve"
  | "approve_remember_prefix"
  | "deny"
  | "deny_custom";

/** Placeholder for the free-form deny row (UI may prefer i18n). */
export const BASH_APPROVAL_DENY_CUSTOM_OPTION_LABEL = "其他";

/** @deprecated Use BASH_APPROVAL_DENY_CUSTOM_OPTION_LABEL */
export const BASH_APPROVAL_DENY_OPTION_LABEL = BASH_APPROVAL_DENY_CUSTOM_OPTION_LABEL;

export const BASH_APPROVAL_REMEMBER_PREFIX_INTRO = "同意，且对于以后续内容开头的命令不再询问 ";

export function buildBashApprovalChoices(options?: {
  includeRememberPrefix?: boolean;
}): BashApprovalChoice[] {
  const includeRemember = options?.includeRememberPrefix !== false;
  const rows: BashApprovalChoice[] = ["approve"];
  if (includeRemember) {
    rows.push("approve_remember_prefix");
  }
  rows.push("deny", "deny_custom");
  return rows;
}

export function formatBashApprovalRememberPrefix(command: string, maxLength = 48): string {
  const trimmed = command.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

export function buildBashApprovalRememberPrefixLabel(command: string): string {
  return `同意，且对于以后续内容开头的命令不再询问 ${formatBashApprovalRememberPrefix(command)}`;
}

export function deriveBashApprovalRememberPrefix(command: string): string {
  return command.trim();
}

export function commandMatchesRememberedBashPrefix(command: string, prefix: string): boolean {
  const trimmedPrefix = prefix.trim();
  if (!trimmedPrefix) {
    return false;
  }
  const trimmedCommand = command.trim();
  return trimmedCommand === trimmedPrefix || trimmedCommand.startsWith(trimmedPrefix);
}

export function commandMatchesAnyRememberedBashPrefix(
  command: string,
  prefixes: readonly string[],
): boolean {
  return prefixes.some((prefix) => commandMatchesRememberedBashPrefix(command, prefix));
}

export function formatBashApprovalDenyMessage(feedback?: string): string {
  const trimmed = feedback?.trim();
  if (!trimmed) {
    return "User denied this Bash command.";
  }
  return `User denied this Bash command. User feedback: ${trimmed}`;
}

export function formatFilesystemApprovalDenyMessage(toolName: string, feedback?: string): string {
  const trimmed = feedback?.trim();
  if (!trimmed) {
    return `User denied this ${toolName} call.`;
  }
  return `User denied this ${toolName} call. User feedback: ${trimmed}`;
}
