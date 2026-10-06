import type { TFunction } from "i18next";
import { Clock3 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FeedNotice } from "./FeedNotice";
import { resolveThreadIdleDuration, type ThreadIdleDuration } from "./thread-idle-cache-warning";

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

export function ThreadIdleCacheWarning({ lastActivityAt, onStartNewThread }: ThreadIdleCacheWarningProps) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const [dismissedActivityAt, setDismissedActivityAt] = useState<string>();
  const duration = resolveThreadIdleDuration(lastActivityAt, now);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!duration || dismissedActivityAt === lastActivityAt) {
    return null;
  }

  return (
    <FeedNotice
      title={t("thread.idleCacheWarningTitle")}
      description={
        <p>
          {t("thread.idleCacheWarning", {
            duration: formatIdleDuration(duration, t),
          })}
        </p>
      }
      icon={<Clock3 size={20} strokeWidth={1.8} aria-hidden />}
      primaryAction={{
        label: t("thread.idleCacheWarningAction"),
        onClick: onStartNewThread,
      }}
      dismissAction={{
        label: t("thread.idleCacheWarningDismiss"),
        onClick: () => setDismissedActivityAt(lastActivityAt),
      }}
    />
  );
}
