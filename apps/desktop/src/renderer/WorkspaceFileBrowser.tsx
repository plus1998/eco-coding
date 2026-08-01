import {
  Braces,
  Boxes,
  File,
  FileCode2,
  FileText,
  GitBranch,
  Hash,
  Image as ImageIcon,
  RotateCcw,
  Search,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ancestorDirectories,
  basename,
  buildWorkspaceRoot,
  mergeWorkspaceEntries,
  type WorkspaceEntry,
  type WorkspaceTreeItem,
} from "./workspace-file-browser-logic";
import { WorkspaceExplorerTree } from "./WorkspaceExplorerTree";
import { WorkspaceFilePreview, type WorkspaceFile } from "./WorkspaceFilePreview";
import "./workspace-file-browser.css";

interface WorkspaceApi {
  listWorkspaceEntries(input: { workspacePath: string; directoryPath: string }): Promise<WorkspaceEntry[]>;
  readWorkspaceFile(input: { workspacePath: string; filePath: string }): Promise<WorkspaceFile>;
}

export interface WorkspaceFileBrowserProps {
  workspacePath: string;
  target?: { path: string; line?: number; column?: number; requestId: number; restricted?: boolean };
}

function filterWorkspaceItems(
  items: Record<string, WorkspaceTreeItem>,
  rootItem: string,
  query: string,
): Record<string, WorkspaceTreeItem> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return items;

  const result: Record<string, WorkspaceTreeItem> = {};
  const keep = (index: string): boolean => {
    const item = items[index];
    if (!item) return false;
    const matches = item.data.toLowerCase().includes(normalizedQuery);
    if (!item.isFolder) {
      if (matches) result[index] = item;
      return matches;
    }
    const children = (item.children ?? []).filter(keep);
    if (matches || children.length > 0) {
      result[index] = {
        ...item,
        children: matches ? (item.children ?? []) : children,
      };
      return true;
    }
    return false;
  };
  keep(rootItem);
  return result;
}

function fileTypeIcon(filePath: string): ReactNode {
  const name = basename(filePath).toLowerCase();
  if (name === "index.html" || name.endsWith(".html") || name.endsWith(".htm")) {
    return <Hash className="workspace-file-browser__file-icon is-html" size={16} aria-hidden />;
  }
  if (name.includes("vite.config") || name.includes("vitest.config")) {
    return <Zap className="workspace-file-browser__file-icon is-config" size={16} aria-hidden />;
  }
  if (name === "biome.json" || name === "biome.jsonc") {
    return <Braces className="workspace-file-browser__file-icon is-biome" size={16} aria-hidden />;
  }
  if (name === ".gitignore" || name === ".gitattributes" || name === ".gitmodules") {
    return <GitBranch className="workspace-file-browser__file-icon is-git" size={16} aria-hidden />;
  }
  if (name === "bun.lock" || name === "bun.lockb" || name === "bunfig.toml") {
    return <File className="workspace-file-browser__file-icon is-bun" size={16} aria-hidden />;
  }
  if (name.endsWith(".json") || name.endsWith(".jsonc")) {
    return <Braces className="workspace-file-browser__file-icon is-json" size={16} aria-hidden />;
  }
  if (name.endsWith(".yml") || name.endsWith(".yaml")) {
    return <Boxes className="workspace-file-browser__file-icon is-yaml" size={16} aria-hidden />;
  }
  if (
    name.endsWith(".png")
    || name.endsWith(".jpg")
    || name.endsWith(".jpeg")
    || name.endsWith(".gif")
    || name.endsWith(".webp")
    || name.endsWith(".svg")
    || name.endsWith(".ico")
  ) {
    return <ImageIcon className="workspace-file-browser__file-icon is-image" size={16} aria-hidden />;
  }
  if (name.endsWith(".md") || name.endsWith(".mdx")) {
    return <FileText className="workspace-file-browser__file-icon is-markdown" size={16} aria-hidden />;
  }
  if (
    name.endsWith(".tsx")
    || name.endsWith(".ts")
    || name.endsWith(".jsx")
    || name.endsWith(".js")
    || name.endsWith(".mjs")
    || name.endsWith(".cjs")
  ) {
    return <FileCode2 className="workspace-file-browser__file-icon is-script" size={16} aria-hidden />;
  }
  return <File className="workspace-file-browser__file-icon is-file" size={16} aria-hidden />;
}

export function WorkspaceFileBrowser({ workspacePath, target }: WorkspaceFileBrowserProps) {
  const { t } = useTranslation();
  const api = window.eco as unknown as WorkspaceApi | undefined;
  const [items, setItems] = useState<Record<string, WorkspaceTreeItem>>(() => buildWorkspaceRoot(workspacePath));
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [focusedItem, setFocusedItem] = useState<string>(workspacePath);
  const [activeTarget, setActiveTarget] = useState<WorkspaceFileBrowserProps["target"]>();
  const [file, setFile] = useState<WorkspaceFile | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeQuery, setTreeQuery] = useState("");
  const requestRef = useRef(0);

  const loadDirectory = useCallback(async (directoryPath: string) => {
    if (!api) {
      setTreeError(t("fileBrowser.apiUnavailable"));
      return false;
    }
    try {
      const entries = await api.listWorkspaceEntries({ workspacePath, directoryPath });
      setItems((current) => mergeWorkspaceEntries(current, directoryPath, entries));
      setTreeError(null);
      return true;
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : t("fileBrowser.directoryLoadFailed"));
      return false;
    }
  }, [api, t, workspacePath]);

  useEffect(() => {
    setItems(buildWorkspaceRoot(workspacePath));
    setExpandedItems([workspacePath]);
    setSelectedItems([]);
    setFocusedItem(workspacePath);
    setFile(null);
    setActiveTarget(undefined);
    setStatus("idle");
    setErrorMessage(null);
    setTreeQuery("");
    void loadDirectory(workspacePath);
  }, [loadDirectory, workspacePath]);

  const readFile = useCallback(async (filePath: string, requestId: number) => {
    if (!api) {
      setErrorMessage(t("fileBrowser.apiUnavailable"));
      setStatus("error");
      return;
    }
    setStatus("loading");
    setErrorMessage(null);
    try {
      const result = await api.readWorkspaceFile({ workspacePath, filePath });
      if (requestId !== requestRef.current) return;
      setFile(result);
      setStatus("idle");
    } catch (error) {
      if (requestId === requestRef.current) {
        setErrorMessage(error instanceof Error ? error.message : t("fileBrowser.readFailed"));
        setStatus("error");
      }
    }
  }, [api, t, workspacePath]);

  const selectFile = useCallback((filePath: string) => {
    const requestId = ++requestRef.current;
    setSelectedItems([filePath]);
    setFocusedItem(filePath);
    setActiveTarget({ path: filePath, requestId });
    setFile(null);
    void readFile(filePath, requestId);
  }, [readFile]);

  useEffect(() => {
    if (!target || target.path === workspacePath) return;
    const requestId = ++requestRef.current;
    setSelectedItems([target.path]);
    setFocusedItem(target.path);
    setActiveTarget({ ...target, requestId });
    if (target.restricted) {
      setFile(null);
      setStatus("idle");
      setErrorMessage(null);
    } else {
      setFile(null);
      void readFile(target.path, requestId);
    }
    void (async () => {
      if (!api) return;
      const directories = ancestorDirectories(workspacePath, target.path);
      let parent = workspacePath;
      try {
        for (const directory of directories) {
          if (!(await loadDirectory(parent))) return;
          parent = directory;
        }
        if (!(await loadDirectory(parent))) return;
        if (requestId === requestRef.current) {
          setExpandedItems((current) => [...new Set([...current, ...directories, workspacePath])]);
        }
      } catch {
        // loadDirectory catches expected IPC failures; this keeps an unexpected failure local.
      }
    })();
  }, [api, loadDirectory, readFile, target, workspacePath]);

  const retryActiveFile = () => {
    if (!activeTarget || activeTarget.restricted) return;
    const requestId = ++requestRef.current;
    setActiveTarget({ ...activeTarget, requestId });
    void readFile(activeTarget.path, requestId);
  };

  const visibleItems = useMemo(
    () => filterWorkspaceItems(items, workspacePath, treeQuery),
    [items, treeQuery, workspacePath],
  );
  const visibleExpandedItems = useMemo(() => {
    if (!treeQuery.trim()) return expandedItems;
    return Object.values(visibleItems)
      .filter((item) => item.isFolder)
      .map((item) => item.index);
  }, [expandedItems, treeQuery, visibleItems]);
  const visibleSelectedItems = selectedItems.filter((index) => visibleItems[index]);
  const visibleFocusedItem = visibleItems[focusedItem] ? focusedItem : workspacePath;

  return (
    <div className="workspace-file-browser">
      <div className="workspace-file-browser__tree">
        <label className="workspace-file-browser__search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={treeQuery}
            placeholder={t("fileBrowser.filterFiles")}
            aria-label={t("fileBrowser.filterFiles")}
            onChange={(event) => setTreeQuery(event.target.value)}
          />
          {treeQuery ? (
            <button
              type="button"
              className="workspace-file-browser__search-clear"
              aria-label={t("common.clear")}
              title={t("common.clear")}
              onClick={() => setTreeQuery("")}
            >
              ×
            </button>
          ) : null}
        </label>
        {treeError ? (
          <div className="workspace-file-browser__tree-error" role="status">
            <span>{t("fileBrowser.directoryLoadFailed")}: {treeError}</span>
            <button type="button" onClick={() => void loadDirectory(workspacePath)}>
              <RotateCcw size={13} aria-hidden="true" />
              {t("fileBrowser.retry")}
            </button>
          </div>
        ) : null}
        <WorkspaceExplorerTree
          items={visibleItems}
          rootItem={workspacePath}
          expandedItems={visibleExpandedItems}
          selectedItems={visibleSelectedItems}
          focusedItem={visibleFocusedItem}
          treeLabel={t("fileBrowser.treeLabel", { workspace: basename(workspacePath) })}
          hideRoot
          className="workspace-file-browser__explorer"
          renderLeading={(item) => (item.isFolder ? null : fileTypeIcon(item.index))}
          onExpandItem={(index) => {
            setExpandedItems((current) => [...new Set([...current, index])]);
            if (items[index]?.isFolder && items[index]?.children?.length === 0) {
              void loadDirectory(index);
            }
          }}
          onCollapseItem={(index) => {
            setExpandedItems((current) => current.filter((value) => value !== index));
          }}
          onSelectItem={(index) => {
            setSelectedItems([index]);
            const selectedItem = items[index];
            if (selectedItem && !selectedItem.isFolder) selectFile(index);
          }}
          onFocusItem={setFocusedItem}
        />
      </div>
      <div className="workspace-file-browser__preview">
        {activeTarget?.restricted ? (
          <div className="workspace-file-browser__message">{t("fileBrowser.restricted")}</div>
        ) : status === "loading" ? (
          <div className="workspace-file-browser__message">{t("fileBrowser.loadingFile", { name: basename(activeTarget?.path || "") })}</div>
        ) : status === "error" ? (
          <div className="workspace-file-browser__error">
            <p>{t("fileBrowser.readFailed")}: {errorMessage || t("fileBrowser.unknownError")}</p>
            <button type="button" onClick={retryActiveFile} disabled={!activeTarget}>
              <RotateCcw size={13} aria-hidden="true" />
              {t("fileBrowser.retry")}
            </button>
          </div>
        ) : file ? (
          <WorkspaceFilePreview
            file={file}
            {...(activeTarget && { target: activeTarget })}
          />
        ) : (
          <div className="workspace-file-browser__message">{t("fileBrowser.selectFile")}</div>
        )}
        {file?.truncated ? <div className="workspace-file-browser__status">{t("fileBrowser.truncated")}</div> : null}
      </div>
    </div>
  );
}
