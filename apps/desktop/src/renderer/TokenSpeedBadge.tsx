import { createContext, useContext, useEffect, useState } from "react";
import type {
  ThreadRunProjectionRequestSpan,
  ThreadRunProjectionTimelineItem,
} from "../shared/thread-run-projection";
import { i18n } from "./i18n";
import {
  formatTokenSpeedRate,
  formatTokenSpeedSeconds,
  formatTokenSpeedStats,
  isTokenSpeedSpanActive,
  resolveLenientRequestSpan,
} from "./token-speed";
import { readStoredTokenSpeedPreferences, TOKEN_SPEED_CHANGE_EVENT } from "./token-speed-preferences";

/** Provided by `ActivityLogView` so the badge can fall back to a lenient span match. */
export const RequestSpansContext = createContext<readonly ThreadRunProjectionRequestSpan[]>([]);

interface TokenSpeedBadgeProps {
  /** Exact span resolved by the caller (may be undefined when `requestId` did not propagate). */
  requestSpan?: ThreadRunProjectionRequestSpan;
  /** The timeline item the badge belongs to — used for a lenient span fallback. */
  item?: ThreadRunProjectionTimelineItem;
  streamedText: string;
}

const TOKEN_SPEED_TICK_MS = 500;

export function TokenSpeedBadge({ requestSpan, item, streamedText }: TokenSpeedBadgeProps) {
  const requestSpans = useContext(RequestSpansContext);
  const [enabled, setEnabled] = useState(() => readStoredTokenSpeedPreferences().showTokenSpeed);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const span = requestSpan ?? (item ? resolveLenientRequestSpan(item, requestSpans) : undefined);
  const active = span ? isTokenSpeedSpanActive(span) : false;

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ showTokenSpeed: boolean }>).detail;
      setEnabled(Boolean(detail?.showTokenSpeed));
    };
    window.addEventListener(TOKEN_SPEED_CHANGE_EVENT, update);
    return () => window.removeEventListener(TOKEN_SPEED_CHANGE_EVENT, update);
  }, []);

  useEffect(() => {
    if (!enabled || !active) {
      return undefined;
    }
    const interval = setInterval(() => setNowMs(Date.now()), TOKEN_SPEED_TICK_MS);
    return () => clearInterval(interval);
  }, [enabled, active]);

  if (!enabled || !span) {
    return null;
  }

  const stats = formatTokenSpeedStats(span, streamedText, nowMs);
  const waitingMs = stats.waitingMs ?? 0;
  const parts: string[] = [];
  if (stats.waitingMs !== undefined) {
    parts.push(i18n.t("activity.tokenSpeed.waiting", { seconds: formatTokenSpeedSeconds(waitingMs) }));
  }
  if (stats.ttftMs !== undefined) {
    parts.push(i18n.t("activity.tokenSpeed.ttft", { seconds: formatTokenSpeedSeconds(stats.ttftMs) }));
  }
  if (stats.rateTps !== undefined) {
    parts.push(
      i18n.t(
        stats.tokenSource === "usage" ? "activity.tokenSpeed.rate" : "activity.tokenSpeed.rateEstimated",
        { rate: formatTokenSpeedRate(stats.rateTps) },
      ),
    );
  }
  if (parts.length === 0) {
    return null;
  }

  const label = parts.join(" · ");
  const hintKey =
    stats.tokenSource === "usage" ? "activity.tokenSpeed.usageHint" : "activity.tokenSpeed.estimatedHint";
  return (
    <span
      className="run-log-request-timing run-log-token-speed"
      role="status"
      aria-live="polite"
      title={i18n.t(hintKey)}
    >
      {label}
    </span>
  );
}
