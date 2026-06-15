import {
  ChevronDown,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  Github,
  Laptop,
  PlusSquare,
  Settings2,
} from "lucide-react";
import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { GitWorkingTreeStatus } from "../shared/ipc";

const POPOVER_WIDTH = 320;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;
const MIN_POPOVER_HEIGHT = 120;

function clampPopoverLeft(anchorLeft: number, width: number): number {
  const maxLeft = window.innerWidth - VIEWPORT_MARGIN - width;
  return Math.max(VIEWPORT_MARGIN, Math.min(anchorLeft, maxLeft));
}

function popoverStyleForAnchor(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
  const spaceAbove = rect.top - VIEWPORT_MARGIN;
  const maxHeight = Math.max(MIN_POPOVER_HEIGHT, spaceAbove - ANCHOR_GAP);
  return {
    position: "fixed",
    left: clampPopoverLeft(rect.left, width),
    bottom: window.innerHeight - rect.top + ANCHOR_GAP,
    width,
    maxHeight,
    zIndex: 10000,
  };
}

interface ComposerEnvironmentPopoverProps {
  workspacePath?: string;
  workspaceLabel: string;
  gitStatus?: GitWorkingTreeStatus;
  gitBusy?: boolean;
  commitDisabled?: boolean;
  onRefresh?: () => void;
  onCheckoutBranch?: (branch: string) => void | Promise<void>;
  onOpenCommitDialog?: () => void;
  onOpenGitSettings?: () => void;
}

export function ComposerEnvironmentPopover({
  workspacePath,
  workspaceLabel,
  gitStatus,
  gitBusy,
  commitDisabled,
  onRefresh,
  onCheckoutBranch,
  onOpenCommitDialog,
  onOpenGitSettings,
}: ComposerEnvironmentPopoverProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() => ({ visibility: "hidden" }));
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [localMenuOpen, setLocalMenuOpen] = useState(false);

  const clickable = Boolean(workspacePath);
  const dirtyCount = gitStatus?.dirtyFileCount ?? 0;
  const pillLabel =
    gitStatus?.isGitRepository && dirtyCount > 0
      ? `${gitStatus.branch ?? "git"} · ${dirtyCount}`
      : gitStatus?.branch ?? "环境";

  const updatePanelPosition = useCallback(() => {
    const anchor = buttonRef.current;
    if (!anchor) {
      return;
    }
    setPanelStyle(popoverStyleForAnchor(anchor));
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
      setBranchMenuOpen(false);
      setLocalMenuOpen(false);
      return;
    }
    onRefresh?.();
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
  }, [open, onRefresh]);

  const canCommit = Boolean(
    gitStatus?.isGitRepository && gitStatus.canCommit && !commitDisabled && !gitBusy,
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={[
          "composer-meta-pill",
          clickable ? "is-clickable" : "",
          open ? "is-active" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={!clickable}
        aria-expanded={open}
        aria-label="环境信息"
        onClick={() => {
          if (!clickable) {
            return;
          }
          setOpen((current) => !current);
        }}
      >
        <FolderGit2 size={14} aria-hidden />
        <span>{pillLabel}</span>
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && clickable ? (
        <EnvironmentPopoverPanel
          panelRef={panelRef}
          panelStyle={panelStyle}
          workspaceLabel={workspaceLabel}
          {...(gitStatus && { gitStatus })}
          gitBusy={gitBusy}
          canCommit={canCommit}
          branchMenuOpen={branchMenuOpen}
          localMenuOpen={localMenuOpen}
          onToggleBranchMenu={() => setBranchMenuOpen((current) => !current)}
          onToggleLocalMenu={() => setLocalMenuOpen((current) => !current)}
          onCheckoutBranch={async (branch) => {
            await onCheckoutBranch?.(branch);
            setBranchMenuOpen(false);
          }}
          onOpenCommitDialog={() => {
            setOpen(false);
            onOpenCommitDialog?.();
          }}
          onOpenGitSettings={() => {
            setOpen(false);
            onOpenGitSettings?.();
          }}
        />
      ) : null}
    </>
  );
}

function EnvironmentPopoverPanel({
  panelRef,
  panelStyle,
  workspaceLabel,
  gitStatus,
  gitBusy,
  canCommit,
  branchMenuOpen,
  localMenuOpen,
  onToggleBranchMenu,
  onToggleLocalMenu,
  onCheckoutBranch,
  onOpenCommitDialog,
  onOpenGitSettings,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  panelStyle: CSSProperties;
  workspaceLabel: string;
  gitStatus?: GitWorkingTreeStatus;
  gitBusy?: boolean;
  canCommit: boolean;
  branchMenuOpen: boolean;
  localMenuOpen: boolean;
  onToggleBranchMenu: () => void;
  onToggleLocalMenu: () => void;
  onCheckoutBranch: (branch: string) => void | Promise<void>;
  onOpenCommitDialog: () => void;
  onOpenGitSettings: () => void;
}) {
  const ghLabel = gitStatus?.gh.authenticated
    ? "GitHub CLI 已登录"
    : gitStatus?.gh.available
      ? "GitHub CLI 未登录"
      : "GitHub CLI 不可用";

  return createPortal(
    <div
      ref={panelRef}
      className="composer-codex-popover composer-env-popover"
      role="dialog"
      aria-label="环境信息"
      style={panelStyle}
    >
      <header className="composer-env-popover-header">
        <p className="composer-codex-popover-title">环境信息</p>
        <button
          type="button"
          className="composer-env-settings-button"
          aria-label="Git 设置"
          onClick={onOpenGitSettings}
        >
          <Settings2 size={14} />
        </button>
      </header>
      <ul className="composer-env-popover-list">
        <li className="composer-env-popover-row">
          <PlusSquare size={14} aria-hidden />
          <span>变更</span>
          <span className="composer-env-popover-value">
            {gitBusy ? "…" : gitStatus?.dirtyFileCount ?? 0}
          </span>
        </li>
        <li className="composer-env-popover-row composer-env-popover-row-menu">
          <button type="button" className="composer-env-menu-trigger" onClick={onToggleLocalMenu}>
            <Laptop size={14} aria-hidden />
            <span>本地</span>
            <span className="composer-env-popover-value">{workspaceLabel}</span>
            <ChevronDown size={12} aria-hidden />
          </button>
          {localMenuOpen ? (
            <div className="composer-env-submenu">
              <span className="composer-env-submenu-item is-active" title={workspaceLabel}>
                {workspaceLabel}
              </span>
            </div>
          ) : null}
        </li>
        <li className="composer-env-popover-row composer-env-popover-row-menu">
          <button
            type="button"
            className="composer-env-menu-trigger"
            onClick={onToggleBranchMenu}
            disabled={!gitStatus?.isGitRepository || gitBusy}
          >
            <GitBranch size={14} aria-hidden />
            <span>{gitStatus?.branch ?? "main"}</span>
            <ChevronDown size={12} aria-hidden />
          </button>
          {branchMenuOpen && gitStatus?.branches.length ? (
            <ul className="composer-env-submenu">
              {gitStatus.branches.map((branch) => (
                <li key={branch}>
                  <button
                    type="button"
                    className={
                      branch === gitStatus.branch
                        ? "composer-env-submenu-item is-active"
                        : "composer-env-submenu-item"
                    }
                    onClick={() => void onCheckoutBranch(branch)}
                  >
                    {branch}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
        <li className="composer-env-popover-row">
          <button
            type="button"
            className="composer-env-action-button"
            disabled={!canCommit}
            onClick={onOpenCommitDialog}
          >
            <GitCommitHorizontal size={14} aria-hidden />
            <span>提交或推送</span>
          </button>
        </li>
        <li className="composer-env-popover-row is-muted">
          <Github size={14} aria-hidden />
          <span title={gitStatus?.gh.reason}>{ghLabel}</span>
        </li>
      </ul>
      <section className="composer-env-source-section">
        <h4>来源</h4>
        <p className="composer-env-source-value">
          {gitStatus?.remoteOriginUrl?.trim() || "暂无来源"}
        </p>
      </section>
    </div>,
    document.body,
  );
}
