import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight, FolderClosed } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { activityHeaderProjectInfoPopoverBoxForRect } from "./activity-header-project-info-layout";
import { ICON_SIZE, ICON_STROKE } from "./icon-metrics";

export interface ActivityHeaderProjectInfoPanelProps {
  projectName: string;
  projectPath: string;
  threadCount: number;
  threadId: string;
  onOpenProjectFolder: () => void;
}

export interface ActivityHeaderProjectInfoProps {
  projectName: string;
  projectPath: string;
  threadCount: number;
  threadId: string;
  onError: (message: string) => void;
}

const POPOVER_SPRING = { type: "spring" as const, bounce: 0, duration: 0.34 };
const POPOVER_FADE = { duration: 0.18, ease: "easeOut" as const };

function panelStyleFromAnchor(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  return activityHeaderProjectInfoPopoverBoxForRect(rect, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
}

export function ActivityHeaderProjectInfoPanel({
  projectName,
  projectPath,
  threadCount,
  threadId,
  onOpenProjectFolder,
}: ActivityHeaderProjectInfoPanelProps) {
  const { t } = useTranslation();
  return (
    <div className="activity-header-project-info-panel">
      <header className="activity-header-project-info-hero">
        <h3 className="activity-header-project-info-name">{projectName}</h3>
        <p className="activity-header-project-info-count">
          {t("thread.projectSessionCount", { count: threadCount })}
        </p>
      </header>
      <div className="activity-header-project-info-groups">
        <button
          type="button"
          className="activity-header-project-info-action"
          title={t("thread.openProjectFolder")}
          onClick={onOpenProjectFolder}
        >
          <span className="activity-header-project-info-action-icon" aria-hidden>
            <FolderClosed size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
          </span>
          <span className="activity-header-project-info-action-copy">
            <span className="activity-header-project-info-action-title">
              {t("thread.openProjectFolder")}
            </span>
            <span className="activity-header-project-info-path">{projectPath}</span>
          </span>
          <ChevronRight
            className="activity-header-project-info-chevron"
            size={14}
            strokeWidth={ICON_STROKE}
            aria-hidden
          />
        </button>
        <div className="activity-header-project-info-meta">
          <span className="activity-header-project-info-label">{t("thread.sessionId")}</span>
          <span className="activity-header-project-info-id">{threadId}</span>
        </div>
      </div>
    </div>
  );
}

export function ActivityHeaderProjectInfo({
  projectName,
  projectPath,
  threadCount,
  threadId,
  onError,
}: ActivityHeaderProjectInfoProps) {
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() => ({ visibility: "hidden" }));

  const updatePanelPosition = useCallback(() => {
    const anchor = buttonRef.current;
    if (!anchor) {
      return;
    }
    setPanelStyle(panelStyleFromAnchor(anchor));
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function openProjectFolder() {
    if (!window.eco?.openWorkspaceInFileManager) {
      onError(t("app.preload.openWorkspaceInFileManager"));
      return;
    }
    try {
      await window.eco.openWorkspaceInFileManager(projectPath);
      setOpen(false);
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : t("thread.openProjectFolderFailed", { detail: String(error) }),
      );
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={[
          "activity-header-project-info-trigger",
          open ? "is-open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        title={t("thread.projectInfo")}
        aria-label={t("thread.projectInfo")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <FolderClosed size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} aria-hidden />
      </button>
      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <motion.div
                  key="activity-header-project-info"
                  ref={panelRef}
                  className="activity-header-project-info-popover"
                  role="dialog"
                  aria-label={t("thread.projectInfo")}
                  style={{ ...panelStyle, transformOrigin: "20px 0px" }}
                  initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -6 }}
                  animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                  exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -6 }}
                  transition={prefersReducedMotion ? POPOVER_FADE : POPOVER_SPRING}
                >
                  <ActivityHeaderProjectInfoPanel
                    projectName={projectName}
                    projectPath={projectPath}
                    threadCount={threadCount}
                    threadId={threadId}
                    onOpenProjectFolder={() => {
                      void openProjectFolder();
                    }}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}
