import { Clock3, MessageCirclePlus } from "lucide-react";
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  resolveThreadIdleDuration,
  type ThreadIdleDuration,
} from "./thread-idle-cache-warning";

interface ThreadIdleCacheWarningProps {
  lastActivityAt: string | undefined;
  onStartNewThread: () => void;
}

function formatIdleDuration(duration: ThreadIdleDuration, t: TFunction): string {
  if (duration.hours === 0) {
    return t("time.minutes", { count: duration.totalMinutes });
  }
  if (duration.minutes === 0) {
    return t("time.hours", { count: duration.hours });
  }
  return t("time.hoursMinutes", {
    hours: duration.hours,
    minutes: duration.minutes,
  });
}

export function ThreadIdleCacheWarning({
  lastActivityAt,
  onStartNewThread,
}: ThreadIdleCacheWarningProps) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const duration = resolveThreadIdleDuration(lastActivityAt, now);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [lastActivityAt]);

  if (!duration) {
    return null;
  }

  return (
    <div className="composer-idle-cache-warning" role="status" aria-live="polite">
      <div className="composer-idle-cache-warning-copy">
        <Clock3 size={15} strokeWidth={1.8} aria-hidden />
        <p>
          {t("thread.idleCacheWarning", {
            duration: formatIdleDuration(duration, t),
          })}
        </p>
      </div>
      <button
        type="button"
        className="composer-idle-cache-action"
        onClick={onStartNewThread}
        title={t("thread.idleCacheWarningAction")}
      >
        <MessageCirclePlus size={14} strokeWidth={1.8} aria-hidden />
        {t("thread.idleCacheWarningAction")}
      </button>
    </div>
  );
}
