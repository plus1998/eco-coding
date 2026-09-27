import { memo } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "./i18n";

/**
 * Floating "still working" dots drawn over the Composer.
 *
 * Shown while the agent is mid-run with nothing moving on screen — the gap while it
 * writes its next tool call — which the Feed cannot narrate because no row of its own
 * changes during it. See `composer-floating-loading.ts` for the clock that decides when
 * the gap has lasted long enough to be worth admitting to.
 *
 * The mark is the same three dots the Feed's own loading state uses, floated over the
 * Composer instead of inside the Feed, so it reads as "the turn is alive" rather than as
 * another piece of transcript. It never shares the screen with the Feed's waiting line.
 */
export const ComposerFloatingLoading = memo(function ComposerFloatingLoading() {
  useTranslation();

  return (
    <div className="composer-floating-loading" role="status" aria-label={i18n.t("activity.working")}>
      <div className="run-log-projection-loading" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
});
