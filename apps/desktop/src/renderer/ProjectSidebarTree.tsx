import { Folder, FolderOpen, GripVertical } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
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
  currentProjectPath?: string;
  activeThreadId?: string;
  onSwitchProject: (path: string) => void;
  onSelectThread: (thread: ThreadSummary) => void;
  onToggleProjectCollapsed: (path: string) => void;
  onExpandProjectThreads: (path: string) => void;
  onReorderProjects: (draggedPath: string, targetPath: string, position: ProjectReorderPosition) => void;
  onOpenProjectPath: (path: string) => Promise<void>;
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
}: ProjectSidebarTreeProps) {
  const [fileDropActive, setFileDropActive] = useState(false);
  const [draggingPath, setDraggingPath] = useState<string>();
  const [dropTarget, setDropTarget] = useState<{ path: string; position: ProjectReorderPosition }>();
  const dragCounterRef = useRef(0);

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

  function handleProjectDragStart(event: DragEvent<HTMLButtonElement>, projectPath: string) {
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

  return (
    <div
      className={fileDropActive ? "project-tree project-tree-drop-target" : "project-tree"}
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

        return (
          <div key={project.path} className="project-group">
            <div
              className={rowClassNames.join(" ")}
              onDragOver={(event) => handleProjectRowDragOver(event, project.path)}
              onDrop={(event) => handleProjectRowDrop(event, project.path)}
            >
              <button
                type="button"
                className="project-drag-handle"
                draggable
                aria-label="拖拽排序"
                onDragStart={(event) => handleProjectDragStart(event, project.path)}
                onDragEnd={handleProjectDragEnd}
              >
                <GripVertical size={14} />
              </button>
              <button
                type="button"
                className="project-folder-toggle"
                aria-expanded={!collapsed}
                aria-label={collapsed ? "展开项目" : "折叠项目"}
                onClick={() => onToggleProjectCollapsed(project.path)}
              >
                {collapsed ? <Folder size={16} /> : <FolderOpen size={16} />}
              </button>
              <button
                type="button"
                className={
                  currentProjectPath === project.path && !activeThreadId
                    ? "project-group-header active"
                    : "project-group-header"
                }
                onClick={() => onSwitchProject(project.path)}
              >
                <span>{project.name}</span>
              </button>
            </div>
            {!collapsed ? (
              projectThreads.length > 0 ? (
                <>
                  {visibleThreads.map((thread) => (
                    <button
                      key={thread.id}
                      type="button"
                      className={
                        activeThreadId === thread.id ? "chat-item nested active" : "chat-item nested"
                      }
                      onClick={() => onSelectThread(thread)}
                    >
                      <span className="chat-item-title">{thread.title}</span>
                      <span className="chat-item-meta">
                        {thread.status === "running" ||
                        thread.status === "failed" ||
                        thread.status === "blocked" ? (
                          <span className={`status-dot ${thread.status}`} title={thread.status} />
                        ) : null}
                        <span className="chat-item-time">
                          {formatRelativeTime(thread.updatedAt ?? thread.createdAt)}
                        </span>
                      </span>
                    </button>
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
