import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GitCommitRecord } from "../shared/ipc";

const COMMITS_PAGE_SIZE = 5;

export interface WorkspaceGitCommitGraphProps {
  workspacePath: string;
  refreshToken?: string;
  /** When true, always show graph body (parent card handles collapse). */
  embedded?: boolean;
}

export function WorkspaceGitCommitGraph({
  workspacePath,
  refreshToken = "",
  embedded = false,
}: WorkspaceGitCommitGraphProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(embedded);
  const [commits, setCommits] = useState<GitCommitRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const sentinelRef = useRef<HTMLLIElement>(null);
  const graphBodyRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  const loadPage = useCallback(
    async (skip: number, replace: boolean) => {
      if (!window.eco?.listGitCommits || loadingRef.current) {
        return;
      }
      loadingRef.current = true;
      setLoading(true);
      setError(undefined);
      try {
        const result = await window.eco.listGitCommits({
          workspacePath,
          skip,
          limit: COMMITS_PAGE_SIZE,
        });
        setCommits((current) => (replace ? result.commits : [...current, ...result.commits]));
        setHasMore(result.hasMore);
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : t("workspaceGit.historyLoadFailed");
        setError(message);
        if (replace) {
          setCommits([]);
          setHasMore(false);
        }
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [t, workspacePath],
  );

  useEffect(() => {
    if (embedded) {
      setExpanded(true);
    }
  }, [embedded]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    void loadPage(0, true);
  }, [expanded, loadPage, refreshToken]);

  useEffect(() => {
    if (!expanded || !hasMore || loading) {
      return;
    }
    const sentinel = sentinelRef.current;
    const root = graphBodyRef.current;
    if (!sentinel || !root) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadPage(commits.length, false);
        }
      },
      { root, rootMargin: "24px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [commits.length, expanded, hasMore, loadPage, loading]);

  const graphBody = (
    <div ref={graphBodyRef} className="thread-info-workspace-git-graph-body">
      {error ? <p className="thread-info-workspace-git-graph-error">{error}</p> : null}
      {commits.length === 0 && !loading && !error ? (
        <p className="thread-info-workspace-git-graph-empty">{t("workspaceGit.historyEmpty")}</p>
      ) : (
        <ol className="thread-info-workspace-git-graph-list">
          {commits.map((commit, index) => (
            <li
              key={commit.sha}
              className="thread-info-workspace-git-graph-item"
              title={`${commit.subject}\n${commit.author} · ${commit.relativeDate}`}
            >
              <span
                className={
                  index === commits.length - 1 && !hasMore
                    ? "thread-info-workspace-git-graph-rail is-last"
                    : "thread-info-workspace-git-graph-rail"
                }
                aria-hidden
              >
                <span className="thread-info-workspace-git-graph-node" />
              </span>
              <span className="thread-info-workspace-git-graph-content">
                <span className="thread-info-workspace-git-graph-message">{commit.subject}</span>
                {commit.decorations.length > 0 ? (
                  <span className="thread-info-workspace-git-graph-tags">
                    {commit.decorations.map((label) => (
                      <span key={`${commit.sha}-${label}`} className="thread-info-workspace-git-graph-tag">
                        {label}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
          {hasMore ? (
            <li ref={sentinelRef} className="thread-info-workspace-git-graph-sentinel" aria-hidden>
              {loading ? (
                <span className="thread-info-workspace-git-graph-loading">{t("common.loading")}</span>
              ) : null}
            </li>
          ) : null}
        </ol>
      )}
      {loading && commits.length === 0 ? (
        <p className="thread-info-workspace-git-graph-loading">{t("common.loading")}</p>
      ) : null}
    </div>
  );

  if (embedded) {
    return <div className="thread-info-workspace-git-graph is-expanded is-embedded">{graphBody}</div>;
  }

  return (
    <div
      className={expanded ? "thread-info-workspace-git-graph is-expanded" : "thread-info-workspace-git-graph"}
    >
      <button
        type="button"
        className="thread-info-workspace-git-graph-trigger"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="thread-info-workspace-git-graph-title">{t("workspaceGit.graph")}</span>
        <ChevronDown
          size={13}
          className={
            expanded ? "thread-info-workspace-git-chevron open" : "thread-info-workspace-git-chevron"
          }
          aria-hidden
        />
      </button>

      {expanded ? graphBody : null}
    </div>
  );
}
