import type { ThreadActivityLine, ThreadSummary } from "./ipc";

const NOTIFICATION_BODY_MAX_LENGTH = 600;

export interface ThreadCompletionNotificationContent {
  title: string;
  body: string;
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
