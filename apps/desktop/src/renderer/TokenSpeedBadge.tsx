import { createContext, useContext, useEffect, useState } from "react";
import type {
  ThreadRunProjectionRequestSpan,
  ThreadRunProjectionTimelineItem,
} from "../shared/thread-run-projection";
import { i18n } from "./i18n";
import { useTokenSpeedDisplayMode } from "./token-speed-preferences";
import {
  resolveTokenSpeedSegments,
  formatTokenSpeedStats,
  isTokenSpeedEligibleSpan,
  isTokenSpeedSpanActive,
  resolveLenientRequestSpan,
} from "./token-speed";

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
  const mode = useTokenSpeedDisplayMode();
  const [nowMs, setNowMs] = useState(() => Date.now());

  const span = requestSpan ?? (item ? resolveLenientRequestSpan(item, requestSpans) : undefined);
  const active = span ? isTokenSpeedSpanActive(span) : false;

  useEffect(() => {
    if (mode === "hidden" || !active) {
      return undefined;
    }
    const interval = setInterval(() => setNowMs(Date.now()), TOKEN_SPEED_TICK_MS);
    return () => clearInterval(interval);
  }, [mode, active]);

  if (mode === "hidden" || !span || !isTokenSpeedEligibleSpan(span)) {
    return null;
  }

  const stats = formatTokenSpeedStats(span, streamedText, nowMs);
  const segments = resolveTokenSpeedSegments(stats, mode);
  if (segments.length === 0) {
    return null;
  }

  const label = segments
    .map((segment) => {
      switch (segment.key) {
        case "waiting":
          return i18n.t("activity.tokenSpeed.waiting", { seconds: segment.seconds });
        case "ttft":
          return i18n.t("activity.tokenSpeed.ttft", { seconds: segment.seconds });
        case "total":
          return i18n.t("activity.tokenSpeed.total", { rate: segment.rate });
        case "prefill":
          return i18n.t("activity.tokenSpeed.prefill", { rate: segment.rate });
        case "decode":
          return i18n.t(
            segment.estimated ? "activity.tokenSpeed.decodeEstimated" : "activity.tokenSpeed.decode",
            { rate: segment.rate },
          );
      }
    })
    .join(" · ");

  const hintKey =
    stats.tokenSource === "usage" ? "activity.tokenSpeed.usageHint" : "activity.tokenSpeed.estimatedHint";
  const tooltipLines: string[] = [i18n.t(hintKey)];
  if (stats.netMs !== undefined) {
    tooltipLines.push(i18n.t("activity.tokenSpeed.rtt", { ms: Math.round(stats.netMs).toString() }));
  }
  if (stats.prefillTps !== undefined) {
    tooltipLines.push(i18n.t("activity.tokenSpeed.prefillHint"));
  }
  return (
    <span
      className="run-log-request-timing run-log-token-speed"
      role="status"
      aria-live="polite"
      title={tooltipLines.join("\n")}
    >
      {label}
    </span>
  );
}
