import { Folder, FolderOpen, LoaderCircle, MessageSquarePlus, MoreHorizontal, Pin, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import type { ThreadSummary } from "../shared/ipc";
import type { ProjectReorderPosition } from "./project-sidebar-order";
import { formatRelativeTime } from "./relative-time";

const PROJECT_DRAG_MIME = "application/x-eco-project-path";

export interface ProjectTreeItem {
  project: { path: string; name: string };
  projectThreads: ThreadSummary[];
  collapsed: boolean;
  visibleThreads: ThreadSummary[];
  hasMore: boolean;
}

interface ProjectSidebarTreeProps {
  projectTree: ProjectTreeItem[];
  currentProjectPath: string | undefined;
  activeThreadId: string | undefined;
  onSwitchProject: (path: string) => void;
  onSelectThread: (thread: ThreadSummary) => void;
  onToggleProjectCollapsed: (path: string) => void;
  onExpandProjectThreads: (path: string) => void;
  onReorderProjects: (draggedPath: string, targetPath: string, position: ProjectReorderPosition) => void;
  onOpenProjectPath: (path: string) => Promise<void>;
  onPinProject: (path: string) => void;
  onRemoveProject: (path: string) => void;
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
  onSwitchProject,
  onSelectThread,
  onToggleProjectCollapsed,
  onExpandProjectThreads,
  onReorderProjects,
  onOpenProjectPath,
  onPinProject,
  onRemoveProject,
  onDeleteThread,
}: ProjectSidebarTreeProps) {
  const [fileDropActive, setFileDropActive] = useState(false);
  const [draggingPath, setDraggingPath] = useState<string>();
  const [dropTarget, setDropTarget] = useState<{ path: string; position: ProjectReorderPosition }>();
  const [openMenuPath, setOpenMenuPath] = useState<string>();
  const [openThreadMenuId, setOpenThreadMenuId] = useState<string>();
  const dragCounterRef = useRef(0);

  useEffect(() => {
    if (!openMenuPath && !openThreadMenuId) {
      return;
    }
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".sidebar-menu-wrap")) {
        return;
      }
      setOpenMenuPath(undefined);
      setOpenThreadMenuId(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenuPath(undefined);
        setOpenThreadMenuId(undefined);
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenuPath, openThreadMenuId]);

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

  function handleProjectDragStart(event: DragEvent<HTMLDivElement>, projectPath: string) {
    event.dataTransfer.setData(PROJECT_DRAG_MIME, projectPath);
    event.dataTransfer.effectAllowed = "move";
    setDraggingPath(projectPath);
  }

  function handleProjectDragEnd() {
    setDraggingPath(undefined);
    setDropTarget(undefined);
  }

  function handleProjectRowDragOver(event: DragEvent<HTMLDivElement>, projectPath: string) {
    if (!isInternalProjectDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const position = resolveDropPosition(event, event.currentTarget);
    setDropTarget({ path: projectPath, position });
  }

  function handleProjectRowDrop(event: DragEvent<HTMLDivElement>, projectPath: string) {
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
  if (openMenuPath || openThreadMenuId) {
    treeClassNames.push("project-tree-menu-open");
  }

  return (
    <div
      className={treeClassNames.join(" ")}
      onDragEnter={handleTreeDragEnter}
      onDragOver={handleTreeDragOver}
      onDragLeave={handleTreeDragLeave}
      onDrop={handleTreeDrop}
    >
      {projectTree.length === 0 ? <p className="project-tree-empty-drop">将文件夹拖到此处打开项目</p> : null}
      {projectTree.map(({ project, projectThreads, collapsed, visibleThreads, hasMore }) => {
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
          <div key={project.path} className="project-group">
            <div
              className={rowClassNames.join(" ")}
              onDragOver={(event) => handleProjectRowDragOver(event, project.path)}
              onDrop={(event) => handleProjectRowDrop(event, project.path)}
            >
              <div
                className={projectMainClassNames.join(" ")}
                draggable
                onDragStart={(event) => handleProjectDragStart(event, project.path)}
                onDragEnd={handleProjectDragEnd}
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
                            onPinProject(project.path);
                            setOpenMenuPath(undefined);
                          }}
                        >
                          <Pin size={16} aria-hidden />
                          <span>置顶</span>
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
              </div>
            </div>
            {!collapsed ? (
              projectThreads.length > 0 ? (
                <>
                  {visibleThreads.map((thread) => (
                    <div
                      key={thread.id}
                      className={
                        activeThreadId === thread.id ? "chat-item-row active" : "chat-item-row"
                      }
                    >
                      <button
                        type="button"
                        className={
                          activeThreadId === thread.id ? "chat-item nested active" : "chat-item nested"
                        }
                        onClick={() => onSelectThread(thread)}
                      >
                        <span className="chat-item-title">{thread.title}</span>
                        <span className="chat-item-meta">
                          {thread.status === "running" || thread.status === "queued" ? (
                            <span
                              className="chat-item-loading"
                              title={thread.status}
                              role="img"
                              aria-label={thread.status}
                            >
                              <LoaderCircle size={14} aria-hidden />
                            </span>
                          ) : thread.status === "failed" || thread.status === "blocked" ? (
                            <span className={`status-dot ${thread.status}`} title={thread.status} />
                          ) : null}
                          <span className="chat-item-time">
                            {formatRelativeTime(thread.updatedAt ?? thread.createdAt)}
                          </span>
                        </span>
                      </button>
                      <span
                        className={
                          openThreadMenuId === thread.id
                            ? "thread-row-actions menu-open"
                            : "thread-row-actions"
                        }
                      >
                        <span className="thread-menu-wrap sidebar-menu-wrap">
                          <button
                            type="button"
                            className="thread-menu-trigger"
                            title={`${thread.title} 操作`}
                            aria-label={`${thread.title} 操作`}
                            aria-haspopup="menu"
                            aria-expanded={openThreadMenuId === thread.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenMenuPath(undefined);
                              setOpenThreadMenuId((current) => (current === thread.id ? undefined : thread.id));
                            }}
                          >
                            <MoreHorizontal size={16} />
                          </button>
                          {openThreadMenuId === thread.id ? (
                            <div className="project-menu thread-menu" role="menu">
                              <button
                                type="button"
                                className="project-menu-item danger"
                                role="menuitem"
                                onClick={() => {
                                  onDeleteThread(thread);
                                  setOpenThreadMenuId(undefined);
                                }}
                              >
                                <Trash2 size={16} aria-hidden />
                                <span>删除对话</span>
                              </button>
                            </div>
                          ) : null}
                        </span>
                      </span>
                    </div>
                  ))}
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
          </div>
        );
      })}
    </div>
  );
}
