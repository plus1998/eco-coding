import {
  Folder,
  FolderOpen,
  LoaderCircle,
  MessageSquarePlus,
  MoreHorizontal,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { type DragEvent, useEffect, useRef, useState } from "react";
import type { ThreadSummary } from "../shared/ipc";
import type { ProjectReorderPosition } from "./project-sidebar-order";
import { formatRelativeTime } from "./relative-time";

const PROJECT_DRAG_MIME = "application/x-eco-project-path";

export interface ProjectTreeItem {
  project: { path: string; name: string; pinned?: boolean };
  projectThreads: ThreadSummary[];
  collapsed: boolean;
  visibleThreads: ThreadSummary[];
  hasMore: boolean;
}

interface ProjectSidebarTreeProps {
  projectTree: ProjectTreeItem[];
  currentProjectPath: string | undefined;
  activeThreadId: string | undefined;
  pinnedThreadIds: ReadonlySet<string>;
  onSwitchProject: (path: string) => void;
  onSelectThread: (thread: ThreadSummary) => void;
  onToggleProjectCollapsed: (path: string) => void;
  onExpandProjectThreads: (path: string) => void;
  onReorderProjects: (draggedPath: string, targetPath: string, position: ProjectReorderPosition) => void;
  onOpenProjectPath: (path: string) => Promise<void>;
  onPinProject: (path: string) => void;
  onUnpinProject: (path: string) => void;
  onRemoveProject: (path: string) => void;
  onPinThread: (threadId: string) => void;
  onUnpinThread: (threadId: string) => void;
  onDeleteThread: (thread: ThreadSummary) => void;
}

function isExternalFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function isInternalProjectDrag(event: DragEvent): boolean {
  return event.dataTransfer.types.includes(PROJECT_DRAG_MIME);
}

function resolveDropPosition(event: DragEvent, element: HTMLElement): ProjectReorderPosition {
  const rect = element.getBoundingClientRect();
  const offsetY = event.clientY - rect.top;
  return offsetY < rect.height / 2 ? "before" : "after";
}

export function ProjectSidebarTree({
  projectTree,
  currentProjectPath,
  activeThreadId,
  pinnedThreadIds,
  onSwitchProject,
  onSelectThread,
  onToggleProjectCollapsed,
  onExpandProjectThreads,
  onReorderProjects,
  onOpenProjectPath,
  onPinProject,
  onUnpinProject,
  onRemoveProject,
  onPinThread,
  onUnpinThread,
  onDeleteThread,
}: ProjectSidebarTreeProps) {
  const [fileDropActive, setFileDropActive] = useState(false);
  const [draggingPath, setDraggingPath] = useState<string>();
  const [dropTarget, setDropTarget] = useState<{ path: string; position: ProjectReorderPosition }>();
  const [openMenuPath, setOpenMenuPath] = useState<string>();
  const dragCounterRef = useRef(0);

  useEffect(() => {
    if (!openMenuPath) {
      return;
    }
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".sidebar-menu-wrap")) {
        return;
      }
      setOpenMenuPath(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenuPath(undefined);
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenuPath]);

  function clearFileDropState() {
    dragCounterRef.current = 0;
    setFileDropActive(false);
  }

  function handleTreeDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!isExternalFileDrag(event)) {
      return;
    }
    event.preventDefault();
    dragCounterRef.current += 1;
    setFileDropActive(true);
  }

  function handleTreeDragOver(event: DragEvent<HTMLDivElement>) {
    if (isInternalProjectDrag(event)) {
      return;
    }
    if (!isExternalFileDrag(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setFileDropActive(true);
  }

  function handleTreeDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!isExternalFileDrag(event)) {
      return;
    }
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setFileDropActive(false);
    }
  }

  async function handleTreeDrop(event: DragEvent<HTMLDivElement>) {
    if (isInternalProjectDrag(event)) {
      return;
    }
    if (!isExternalFileDrag(event)) {
      return;
    }
    event.preventDefault();
    clearFileDropState();

    if (!window.eco) {
      return;
    }

    for (const file of event.dataTransfer.files) {
      const path = window.eco.getPathForFile(file);
      if (!path) {
        continue;
      }
      try {
        await onOpenProjectPath(path);
        return;
      } catch {
        // try next dropped item
      }
    }
  }

  function handleProjectDragStart(event: DragEvent<HTMLElement>, projectPath: string) {
    event.dataTransfer.setData(PROJECT_DRAG_MIME, projectPath);
    event.dataTransfer.effectAllowed = "move";
    setDraggingPath(projectPath);
  }

  function handleProjectDragEnd() {
    setDraggingPath(undefined);
    setDropTarget(undefined);
  }

  function handleProjectRowDragOver(event: DragEvent<HTMLElement>, projectPath: string) {
    if (!isInternalProjectDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const position = resolveDropPosition(event, event.currentTarget);
    setDropTarget({ path: projectPath, position });
  }

  function handleProjectRowDrop(event: DragEvent<HTMLElement>, projectPath: string) {
    if (!isInternalProjectDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const draggedPath = event.dataTransfer.getData(PROJECT_DRAG_MIME);
    if (!draggedPath || draggedPath === projectPath) {
      setDropTarget(undefined);
      setDraggingPath(undefined);
      return;
    }
    const position = resolveDropPosition(event, event.currentTarget);
    onReorderProjects(draggedPath, projectPath, position);
    setDropTarget(undefined);
    setDraggingPath(undefined);
  }

  const treeClassNames = ["project-tree"];
  if (fileDropActive) {
    treeClassNames.push("project-tree-drop-target");
  }
  if (openMenuPath) {
    treeClassNames.push("project-tree-menu-open");
  }

  const pinnedProjectTree = projectTree.filter(({ project }) => project.pinned);
  const regularProjectTree = projectTree.filter(({ project }) => !project.pinned);
  const hasPinnedProjects = pinnedProjectTree.length > 0;

  function renderProjectItem({
    project,
    projectThreads,
    collapsed,
    visibleThreads,
    hasMore,
  }: ProjectTreeItem) {
    const rowClassNames = ["project-group-row"];
    if (draggingPath === project.path) {
      rowClassNames.push("dragging");
    }
    if (dropTarget?.path === project.path && dropTarget.position === "before") {
      rowClassNames.push("drop-before");
    }
    if (dropTarget?.path === project.path && dropTarget.position === "after") {
      rowClassNames.push("drop-after");
    }
    const isProjectActive = currentProjectPath === project.path && !activeThreadId;
    const projectMainClassNames = ["project-group-main"];
    if (isProjectActive) {
      projectMainClassNames.push("active");
    }
    if (openMenuPath === project.path) {
      projectMainClassNames.push("menu-open");
    }

    return (
      <li key={project.path} className="project-group">
        <div className={rowClassNames.join(" ")}>
          <fieldset
            aria-label={`${project.name} 拖拽排序区域`}
            className={projectMainClassNames.join(" ")}
            draggable
            onDragStart={(event) => handleProjectDragStart(event, project.path)}
            onDragEnd={handleProjectDragEnd}
            onDragOver={(event) => handleProjectRowDragOver(event, project.path)}
            onDrop={(event) => handleProjectRowDrop(event, project.path)}
          >
            <button
              type="button"
              className="project-group-toggle"
              aria-expanded={!collapsed}
              aria-label={collapsed ? `展开项目 ${project.name}` : `折叠项目 ${project.name}`}
              onClick={() => onToggleProjectCollapsed(project.path)}
            >
              {collapsed ? <Folder size={16} /> : <FolderOpen size={16} />}
              <span>{project.name}</span>
            </button>
            <span
              className={
                openMenuPath === project.path ? "project-row-actions menu-open" : "project-row-actions"
              }
            >
              <span className="project-menu-wrap sidebar-menu-wrap">
                <button
                  type="button"
                  className="project-menu-trigger"
                  title={`${project.name} 操作`}
                  aria-label={`${project.name} 操作`}
                  aria-haspopup="menu"
                  aria-expanded={openMenuPath === project.path}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpenMenuPath((current) => (current === project.path ? undefined : project.path));
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>
                {openMenuPath === project.path ? (
                  <div className="project-menu" role="menu">
                    <button
                      type="button"
                      className="project-menu-item"
                      role="menuitem"
                      onClick={() => {
                        if (project.pinned) {
                          onUnpinProject(project.path);
                        } else {
                          onPinProject(project.path);
                        }
                        setOpenMenuPath(undefined);
                      }}
                    >
                      {project.pinned ? (
                        <PinOff size={16} aria-hidden />
                      ) : (
                        <Pin size={16} aria-hidden />
                      )}
                      <span>{project.pinned ? "取消置顶" : "置顶"}</span>
                    </button>
                    <button
                      type="button"
                      className="project-menu-item danger"
                      role="menuitem"
                      onClick={() => {
                        onRemoveProject(project.path);
                        setOpenMenuPath(undefined);
                      }}
                    >
                      <Trash2 size={16} aria-hidden />
                      <span>移除</span>
                    </button>
                  </div>
                ) : null}
              </span>
              <button
                type="button"
                className="project-new-chat"
                title={`在 ${project.name} 中新建对话`}
                aria-label={`在 ${project.name} 中新建对话`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSwitchProject(project.path);
                }}
              >
                <MessageSquarePlus size={16} />
              </button>
            </span>
          </fieldset>
        </div>
        {!collapsed ? (
          projectThreads.length > 0 ? (
            <>
              {visibleThreads.map((thread) => {
                const isThreadBusy = thread.status === "running" || thread.status === "queued";
                const isThreadAwaitingApproval = isThreadWaitingForApproval(thread);
                const hasThreadStatusIndicator =
                  isThreadAwaitingApproval ||
                  isThreadBusy ||
                  thread.status === "failed" ||
                  thread.status === "blocked";
                const isThreadPinned = pinnedThreadIds.has(thread.id);
                const rowClassName = [
                  "chat-item-row",
                  activeThreadId === thread.id ? "active" : "",
                  isThreadPinned ? "is-thread-pinned" : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <div key={thread.id} className={rowClassName}>
                    <button
                      type="button"
                      className={
                        activeThreadId === thread.id ? "chat-item nested active" : "chat-item nested"
                      }
                      onClick={() => onSelectThread(thread)}
                    >
                      <span className="chat-item-title">{thread.title}</span>
                      {hasThreadStatusIndicator ? (
                        <span className="chat-item-meta">
                          {isThreadAwaitingApproval ? (
                            <span className="chat-item-approval" title={thread.message || "等待批准"}>
                              等待批准
                            </span>
                          ) : isThreadBusy ? (
                            <span
                              className="chat-item-loading"
                              title={thread.status}
                              role="img"
                              aria-label={thread.status}
                            >
                              <LoaderCircle size={14} className="spinning" aria-hidden />
                            </span>
                          ) : (
                            <span className={`status-dot ${thread.status}`} title={thread.status} />
                          )}
                        </span>
                      ) : null}
                    </button>
                    <span
                      className={
                        hasThreadStatusIndicator
                          ? "chat-item-trailing chat-item-trailing-actions-only"
                          : "chat-item-trailing"
                      }
                    >
                      {!hasThreadStatusIndicator ? (
                        <span className="chat-item-trailing-label">
                          {isThreadPinned ? (
                            <span className="chat-item-pin-indicator" aria-hidden>
                              <Pin size={14} />
                            </span>
                          ) : (
                            <span className="chat-item-time">
                              {formatRelativeTime(thread.updatedAt ?? thread.createdAt)}
                            </span>
                          )}
                        </span>
                      ) : null}
                      <span className="chat-item-trailing-actions">
                        {!hasThreadStatusIndicator ? (
                          <button
                            type="button"
                            className="chat-item-row-action"
                            title={isThreadPinned ? "取消置顶" : "置顶"}
                            aria-label={isThreadPinned ? `取消置顶 ${thread.title}` : `置顶 ${thread.title}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (isThreadPinned) {
                                onUnpinThread(thread.id);
                              } else {
                                onPinThread(thread.id);
                              }
                            }}
                          >
                            {isThreadPinned ? (
                              <PinOff size={14} aria-hidden />
                            ) : (
                              <Pin size={14} aria-hidden />
                            )}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="chat-item-row-action chat-item-row-action-danger"
                          title="删除对话"
                          aria-label={`删除对话 ${thread.title}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteThread(thread);
                          }}
                        >
                          <Trash2 size={14} aria-hidden />
                        </button>
                      </span>
                    </span>
                  </div>
                );
              })}
              {hasMore ? (
                <button
                  type="button"
                  className="project-expand"
                  onClick={() => onExpandProjectThreads(project.path)}
                >
                  展开显示
                </button>
              ) : null}
            </>
          ) : (
            <p className="project-empty">暂无对话</p>
          )
        ) : null}
      </li>
    );
  }

  function renderProjectSection(label: string, items: ProjectTreeItem[]) {
    if (items.length === 0 && !hasPinnedProjects) {
      return null;
    }
    return (
      <section className="project-tree-section" aria-label={label}>
        <div className="project-tree-section-label">{label}</div>
        {items.length > 0 ? (
          <ul className="project-tree-section-list">{items.map(renderProjectItem)}</ul>
        ) : null}
      </section>
    );
  }

  return (
    <div
      aria-label="项目列表"
      className={treeClassNames.join(" ")}
      onDragEnter={handleTreeDragEnter}
      onDragOver={handleTreeDragOver}
      onDragLeave={handleTreeDragLeave}
      onDrop={handleTreeDrop}
      role="tree"
    >
      {projectTree.length === 0 ? <p className="project-tree-empty-drop">将文件夹拖到此处打开项目</p> : null}
      {hasPinnedProjects ? renderProjectSection("置顶", pinnedProjectTree) : null}
      {projectTree.length > 0 ? renderProjectSection("项目", regularProjectTree) : null}
    </div>
  );
}

export function isThreadWaitingForApproval(thread: ThreadSummary): boolean {
  if (thread.status !== "running") {
    return false;
  }
  return /等待.*(批准|确认)|approval/i.test(thread.message);
}
