/** Keep this aligned with the prompt-cache episode boundary used by the main process. */
export const THREAD_IDLE_CACHE_WARNING_THRESHOLD_MS = 30 * 60 * 1000;

export interface ThreadIdleDuration {
  idleMs: number;
  totalMinutes: number;
  hours: number;
  minutes: number;
}

export function resolveLatestThreadActivityAt(
  timeline: readonly { at: string }[],
): string | undefined {
  let latestAt: string | undefined;
  let latestMs = Number.NEGATIVE_INFINITY;

  for (const item of timeline) {
    const observedMs = Date.parse(item.at);
    if (Number.isFinite(observedMs) && observedMs > latestMs) {
      latestMs = observedMs;
      latestAt = item.at;
    }
  }

  return latestAt;
}

export function resolveThreadIdleDuration(
  lastActivityAt: string | undefined,
  now = Date.now(),
): ThreadIdleDuration | undefined {
  if (!lastActivityAt) {
    return undefined;
  }

  const lastUpdatedAt = Date.parse(lastActivityAt);
  if (!Number.isFinite(lastUpdatedAt) || !Number.isFinite(now) || now <= lastUpdatedAt) {
    return undefined;
  }

  const idleMs = now - lastUpdatedAt;
  if (idleMs < THREAD_IDLE_CACHE_WARNING_THRESHOLD_MS) {
    return undefined;
  }

  const totalMinutes = Math.floor(idleMs / 60_000);
  return {
    idleMs,
    totalMinutes,
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };
}
