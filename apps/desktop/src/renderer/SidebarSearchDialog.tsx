import { Folder, Search } from "lucide-react";
import { type RefObject, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ThreadSummary } from "../shared/ipc";

export interface SidebarSearchProject {
  path: string;
  name: string;
}

export type SidebarSearchResult =
  | { kind: "thread"; key: string; thread: ThreadSummary; projectName: string }
  | { kind: "project"; key: string; project: SidebarSearchProject };

interface SidebarSearchDialogProps {
  open: boolean;
  threads: readonly ThreadSummary[];
  projects: readonly SidebarSearchProject[];
  onClose: () => void;
  onSelectThread: (thread: ThreadSummary) => void;
  onSelectProject: (path: string) => void;
}

const MAX_THREAD_RESULTS = 10;
const MAX_PROJECT_RESULTS = 8;

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function buildSidebarSearchResults(
  threads: readonly ThreadSummary[],
  projects: readonly SidebarSearchProject[],
  query: string,
): SidebarSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  const projectNames = new Map(projects.map((project) => [project.path, project.name]));
  const threadResults = [...threads]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .filter((thread) => !normalizedQuery || normalizeSearchText(thread.title).includes(normalizedQuery))
    .slice(0, MAX_THREAD_RESULTS)
    .map(
      (thread): SidebarSearchResult => ({
        kind: "thread",
        key: `thread:${thread.id}`,
        thread,
        projectName:
          projectNames.get(thread.workspacePath) ?? thread.workspacePath.split("/").at(-1) ?? "项目",
      }),
    );
  const projectResults = projects
    .filter(
      (project) =>
        !normalizedQuery ||
        normalizeSearchText(project.name).includes(normalizedQuery) ||
        normalizeSearchText(project.path).includes(normalizedQuery),
    )
    .slice(0, MAX_PROJECT_RESULTS)
    .map(
      (project): SidebarSearchResult => ({
        kind: "project",
        key: `project:${project.path}`,
        project,
      }),
    );
  return [...threadResults, ...projectResults];
}

export function SidebarSearchDialog({
  open,
  threads,
  projects,
  onClose,
  onSelectThread,
  onSelectProject,
}: SidebarSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeResultRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const results = useMemo(
    () => buildSidebarSearchResults(threads, projects, deferredQuery),
    [deferredQuery, projects, threads],
  );
  const threadResults = results.filter((result) => result.kind === "thread");
  const projectResults = results.filter((result) => result.kind === "project");
  const activeResult = results[activeIndex];

  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
    setActiveIndex(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  useEffect(() => {
    if (activeIndex < 0) return;
    activeResultRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  function selectResult(result: SidebarSearchResult | undefined) {
    if (!result) return;
    if (result.kind === "thread") {
      onSelectThread(result.thread);
    } else {
      onSelectProject(result.project.path);
    }
    onClose();
  }

  return createPortal(
    <div className="sidebar-search-backdrop">
      <button
        type="button"
        className="sidebar-search-backdrop-close"
        aria-label="关闭搜索"
        tabIndex={-1}
        onClick={onClose}
      />
      <section className="sidebar-search-dialog" role="dialog" aria-modal="true" aria-label="搜索会话和项目">
        <div className="sidebar-search-input-wrap">
          <Search size={19} aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="搜索会话标题或项目"
            aria-label="搜索会话标题或项目"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-activedescendant={activeResult ? `${listboxId}-${activeIndex}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && results.length > 0) {
                event.preventDefault();
                setActiveIndex((current) => (current + 1) % results.length);
                return;
              }
              if (event.key === "ArrowUp" && results.length > 0) {
                event.preventDefault();
                setActiveIndex((current) => (current - 1 + results.length) % results.length);
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                selectResult(activeResult);
              }
            }}
          />
          <kbd>esc</kbd>
        </div>

        <div id={listboxId} className="sidebar-search-results" role="listbox" aria-label="搜索结果">
          {results.length === 0 ? (
            <div className="sidebar-search-empty">没有匹配的会话或项目</div>
          ) : (
            <>
              {threadResults.length > 0 ? (
                <SearchResultGroup
                  label="会话"
                  results={threadResults}
                  allResults={results}
                  activeIndex={activeIndex}
                  listboxId={listboxId}
                  activeResultRef={activeResultRef}
                  onActivate={setActiveIndex}
                  onSelect={selectResult}
                />
              ) : null}
              {projectResults.length > 0 ? (
                <SearchResultGroup
                  label="项目"
                  results={projectResults}
                  allResults={results}
                  activeIndex={activeIndex}
                  listboxId={listboxId}
                  activeResultRef={activeResultRef}
                  onActivate={setActiveIndex}
                  onSelect={selectResult}
                />
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

interface SearchResultGroupProps {
  label: string;
  results: readonly SidebarSearchResult[];
  allResults: readonly SidebarSearchResult[];
  activeIndex: number;
  listboxId: string;
  activeResultRef: RefObject<HTMLButtonElement | null>;
  onActivate: (index: number) => void;
  onSelect: (result: SidebarSearchResult) => void;
}

function SearchResultGroup({
  label,
  results,
  allResults,
  activeIndex,
  listboxId,
  activeResultRef,
  onActivate,
  onSelect,
}: SearchResultGroupProps) {
  return (
    <section className="sidebar-search-group" aria-label={label}>
      <h2>{label}</h2>
      <div className="sidebar-search-group-list">
        {results.map((result) => {
          const index = allResults.findIndex((candidate) => candidate.key === result.key);
          const active = index === activeIndex;
          return (
            <button
              key={result.key}
              id={`${listboxId}-${index}`}
              ref={active ? activeResultRef : undefined}
              type="button"
              role="option"
              aria-selected={active}
              className={active ? "sidebar-search-result is-active" : "sidebar-search-result"}
              onMouseEnter={() => onActivate(index)}
              onClick={() => onSelect(result)}
            >
              <span className="sidebar-search-result-icon" aria-hidden>
                {result.kind === "project" ? <Folder size={17} /> : <span />}
              </span>
              <span className="sidebar-search-result-title">
                {result.kind === "thread" ? result.thread.title : result.project.name}
              </span>
              <span className="sidebar-search-result-meta">
                {result.kind === "thread" ? result.projectName : result.project.path}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
