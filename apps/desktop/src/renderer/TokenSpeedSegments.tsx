import { FileInput, Gauge, TextCursorInput } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { i18n } from "./i18n";
import type { TokenSpeedSegment } from "./token-speed";

const ICON_SIZE = 10;

/** Plain-text label for tooltips / title attributes (keeps the old wording). */
export function formatTokenSpeedSegmentPlain(segment: TokenSpeedSegment): string {
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
}

function SegmentIcon({ kind }: { kind: "total" | "prefill" | "decode" }) {
  const props = {
    size: ICON_SIZE,
    strokeWidth: 2,
    "aria-hidden": true as const,
    className: "token-speed-segment-icon",
  };
  switch (kind) {
    case "total":
      return <Gauge {...props} />;
    case "prefill":
      return <FileInput {...props} />;
    case "decode":
      return <TextCursorInput {...props} />;
  }
}

function renderSegment(segment: TokenSpeedSegment): ReactNode {
  const plain = formatTokenSpeedSegmentPlain(segment);
  switch (segment.key) {
    case "waiting":
    case "ttft":
      return (
        <span className="token-speed-segment" title={plain}>
          {plain}
        </span>
      );
    case "total":
      return (
        <span className="token-speed-segment" title={plain}>
          <SegmentIcon kind="total" />
          <span>{i18n.t("activity.tokenSpeed.rate", { rate: segment.rate })}</span>
        </span>
      );
    case "prefill":
      return (
        <span className="token-speed-segment" title={plain}>
          <SegmentIcon kind="prefill" />
          <span>{i18n.t("activity.tokenSpeed.prefillRate", { rate: segment.rate })}</span>
        </span>
      );
    case "decode":
      return (
        <span className="token-speed-segment" title={plain}>
          <SegmentIcon kind="decode" />
          <span>
            {i18n.t(
              segment.estimated ? "activity.tokenSpeed.rateEstimated" : "activity.tokenSpeed.rate",
              { rate: segment.rate },
            )}
          </span>
        </span>
      );
  }
}

/** Compact token-speed row: icons replace 吞吐 / prefill / decode labels. */
export function TokenSpeedSegmentsView({
  segments,
  className,
}: {
  segments: readonly TokenSpeedSegment[];
  className?: string;
}) {
  if (segments.length === 0) {
    return null;
  }
  return (
    <span className={["token-speed-segments", className].filter(Boolean).join(" ")}>
      {segments.map((segment, index) => (
        <Fragment key={`${segment.key}-${index}`}>
          {index > 0 ? <span className="token-speed-segment-sep"> · </span> : null}
          {renderSegment(segment)}
        </Fragment>
      ))}
    </span>
  );
}
