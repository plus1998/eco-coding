import type {
  BashApprovalRequest,
  ClarificationRequest,
  PlanApprovalRequest,
  ThreadActivityLine,
  ThreadApprovalNotificationKind,
  ThreadSummary,
} from "./ipc";
import { translateCatalog } from "./i18n-catalogs";
import type { AppLocale } from "./locale";
import type { ThreadRunEvent } from "./thread-run-events";

const NOTIFICATION_BODY_MAX_LENGTH = 600;

export interface ThreadCompletionNotificationContent {
  title: string;
  body: string;
}

/** Prefer the first activity source that has a main-agent assistant message. */
export function pickActivityForCompletionNotification(
  sources: readonly (readonly ThreadActivityLine[])[],
): readonly ThreadActivityLine[] {
  for (const activity of sources) {
    if (hasMainAssistantOutput(activity)) {
      return activity;
    }
  }
  return [];
}

export function activityLinesFromThreadRunEvents(
  events: readonly Pick<ThreadRunEvent, "id" | "eventType" | "role" | "agentId" | "message">[],
): ThreadActivityLine[] {
  const lines: ThreadActivityLine[] = [];
  for (const event of events) {
    if (event.eventType !== "message.final") {
      continue;
    }
    if (event.role !== "assistant") {
      continue;
    }
    if (event.agentId?.trim() || !event.message.trim()) {
      continue;
    }
    lines.push({
      id: event.id,
      role: "assistant",
      message: event.message,
      stream: false,
    });
  }
  return lines;
}

function hasMainAssistantOutput(activity: readonly ThreadActivityLine[]): boolean {
  for (let index = activity.length - 1; index >= 0; index -= 1) {
    const line = activity[index];
    if (line?.role === "assistant" && !line.agentId && line.message.trim()) {
      return true;
    }
  }
  return false;
}

export function buildThreadApprovalNotificationContent(
  thread: Pick<ThreadSummary, "title">,
  kind: ThreadApprovalNotificationKind,
  approval: PlanApprovalRequest | BashApprovalRequest,
  locale: AppLocale = "zh-CN",
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
    translateCatalog(
      locale,
      kind === "plan" ? "notification.planApproval" : "notification.bashApproval",
      { detail },
    ),
  );
  return body ? { title, body } : undefined;
}

export function buildThreadClarificationNotificationContent(
  thread: Pick<ThreadSummary, "title">,
  clarification: Pick<ClarificationRequest, "questions">,
  locale: AppLocale = "zh-CN",
): ThreadCompletionNotificationContent | undefined {
  const title = thread.title.trim();
  if (!title) {
    return undefined;
  }

  const detail = buildClarificationDetail(clarification);
  if (!detail) {
    return undefined;
  }
  const body = normalizeNotificationBody(
    translateCatalog(locale, "notification.clarification", { detail }),
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

/** Build completion notification from multiple activity sources (SDK, store, run events). */
export function buildThreadCompletionNotificationContentFromSources(
  thread: Pick<ThreadSummary, "title">,
  sources: readonly (readonly ThreadActivityLine[])[],
): ThreadCompletionNotificationContent | undefined {
  return buildThreadCompletionNotificationContent(
    thread,
    pickActivityForCompletionNotification(sources),
  );
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

function buildClarificationDetail(
  clarification: Pick<ClarificationRequest, "questions">,
): string | undefined {
  for (const question of clarification.questions) {
    const text = question.question.trim() || question.header?.trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}
