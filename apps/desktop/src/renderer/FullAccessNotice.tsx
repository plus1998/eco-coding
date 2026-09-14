import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BashReviewMode } from "../shared/bash-review-ui";
import { FeedNotice } from "./FeedNotice";
import { persistFullAccessNoticeHidden, readFullAccessNoticeHidden } from "./full-access-notice-preferences";

interface FullAccessNoticeProps {
  bashReviewMode: BashReviewMode;
  scopeKey: string;
}

export function FullAccessNotice({ bashReviewMode, scopeKey }: FullAccessNoticeProps) {
  const { t } = useTranslation();
  const previousModeRef = useRef(bashReviewMode);
  const [permanentlyHidden, setPermanentlyHidden] = useState(() => readFullAccessNoticeHidden());
  const [dismissedScopeKey, setDismissedScopeKey] = useState<string>();

  useEffect(() => {
    if (previousModeRef.current !== "allow_all" && bashReviewMode === "allow_all") {
      setDismissedScopeKey(undefined);
    }
    previousModeRef.current = bashReviewMode;
  }, [bashReviewMode]);

  if (bashReviewMode !== "allow_all" || permanentlyHidden || dismissedScopeKey === scopeKey) {
    return null;
  }

  return (
    <FeedNotice
      title={t("feedNotice.fullAccess.title")}
      description={<p>{t("feedNotice.fullAccess.description")}</p>}
      role="alert"
      primaryAction={{
        label: t("feedNotice.fullAccess.neverShow"),
        onClick: () => {
          persistFullAccessNoticeHidden(true);
          setPermanentlyHidden(true);
        },
      }}
      dismissAction={{
        label: t("feedNotice.fullAccess.dismiss"),
        onClick: () => setDismissedScopeKey(scopeKey),
      }}
    />
  );
}
