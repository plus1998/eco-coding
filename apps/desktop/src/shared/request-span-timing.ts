export interface RequestSpanTimingFields {
  status: "waiting_first_token" | "streaming" | "completed" | "failed" | "cancelled";
  startedAt: string;
  firstTokenAt?: string;
}

export function computeRequestSpanWaitingMs(
  fields: RequestSpanTimingFields,
  nowMs = Date.now(),
): number {
  const startedMs = Date.parse(fields.startedAt);
  if (!Number.isFinite(startedMs)) {
    return 0;
  }
  if (fields.firstTokenAt) {
    return 0;
  }
  if (fields.status !== "waiting_first_token" && fields.status !== "streaming") {
    return 0;
  }
  return Math.max(0, nowMs - startedMs);
}

export function computeRequestSpanTtftMs(fields: RequestSpanTimingFields): number | undefined {
  if (!fields.firstTokenAt) {
    return undefined;
  }
  const startedMs = Date.parse(fields.startedAt);
  const firstTokenMs = Date.parse(fields.firstTokenAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(firstTokenMs)) {
    return undefined;
  }
  return Math.max(0, firstTokenMs - startedMs);
}
