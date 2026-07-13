import type {
  BashApprovalRequest,
  PlanApprovalRequest,
  ThreadActivityLine,
  ThreadApprovalNotificationKind,
  ThreadSummary,
} from "./ipc";

const NOTIFICATION_BODY_MAX_LENGTH = 600;

export interface ThreadCompletionNotificationContent {
  title: string;
  body: string;
}

export function buildThreadApprovalNotificationContent(
  thread: Pick<ThreadSummary, "title">,
  kind: ThreadApprovalNotificationKind,
  approval: PlanApprovalRequest | BashApprovalRequest,
): ThreadCompletionNotificationContent | undefined {
  const title = thread.title.trim();
  if (!title) {
    return undefined;
  }

  const detail = kind === "plan" ? buildPlanApprovalDetail(approval) : buildBashApprovalDetail(approval);
  if (!detail) {
    return undefined;
  }
  const body = normalizeNotificationBody(
    kind === "plan" ? `等待计划审批：${detail}` : `等待操作审批：${detail}`,
  );
  return body ? { title, body } : undefined;
}

export function buildThreadCompletionNotificationContent(
  thread: Pick<ThreadSummary, "title">,
  activity: readonly ThreadActivityLine[],
): ThreadCompletionNotificationContent | undefined {
  const title = thread.title.trim();
  if (!title) {
    return undefined;
  }

  let output: string | undefined;
  for (let index = activity.length - 1; index >= 0; index -= 1) {
    const line = activity[index];
    if (line?.role === "assistant" && !line.agentId && line.message.trim()) {
      output = line.message;
      break;
    }
  }
  if (!output) {
    return undefined;
  }

  const body = normalizeNotificationBody(output);
  if (!body) {
    return undefined;
  }
  return { title, body };
}

function normalizeNotificationBody(value: string): string {
  const normalized = value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)]\([^\s)]+(?:\s+"[^"]*")?\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= NOTIFICATION_BODY_MAX_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, NOTIFICATION_BODY_MAX_LENGTH - 1).trimEnd()}…`;
}

function buildPlanApprovalDetail(approval: PlanApprovalRequest | BashApprovalRequest): string | undefined {
  return "plan" in approval ? approval.plan.trim() || undefined : undefined;
}

function buildBashApprovalDetail(approval: PlanApprovalRequest | BashApprovalRequest): string | undefined {
  if (!("command" in approval)) {
    return undefined;
  }
  const filesystemTool = approval.filesystemTool?.trim();
  const filesystemPath = approval.filesystemPath?.trim();
  if (filesystemTool && filesystemPath) {
    return `${filesystemTool} ${filesystemPath}`;
  }
  return approval.command.trim() || undefined;
}
