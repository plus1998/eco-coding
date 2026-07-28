import { File, Folder, FolderOpen, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ControlledTreeEnvironment,
  Tree,
} from "react-complex-tree";
import "react-complex-tree/lib/style.css";
import {
  ancestorDirectories,
  basename,
  buildWorkspaceRoot,
  itemIndex,
  mergeWorkspaceEntries,
  type WorkspaceEntry,
  type WorkspaceTreeItem,
} from "./workspace-file-browser-logic";
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
        if (requestId === requestRef.current) setExpandedItems((current) => [...new Set([...current, ...directories, workspacePath])]);
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
  return (
    <div className="workspace-file-browser">
      <div className="workspace-file-browser__tree">
        {treeError ? (
          <div className="workspace-file-browser__tree-error" role="status">
            <span>{t("fileBrowser.directoryLoadFailed")}: {treeError}</span>
            <button type="button" onClick={() => void loadDirectory(workspacePath)}>
              <RotateCcw size={13} aria-hidden="true" />
              {t("fileBrowser.retry")}
            </button>
          </div>
        ) : null}
        <ControlledTreeEnvironment
          items={items}
          getItemTitle={(item) => item.data}
          viewState={{ workspace: { expandedItems, selectedItems, focusedItem } }}
          onExpandItem={(item) => {
            const index = itemIndex(item);
            setExpandedItems((current) => [...new Set([...current, index])]);
            if (items[index]?.isFolder && items[index]?.children?.length === 0) void loadDirectory(index);
          }}
          onCollapseItem={(item) => setExpandedItems((current) => current.filter((value) => value !== itemIndex(item)))}
          onSelectItems={(selected) => {
            const next = selected.map(String);
            setSelectedItems(next);
            const selectedIndex = next[0];
            const selectedItem = selectedIndex === undefined ? undefined : items[selectedIndex];
            if (selectedIndex !== undefined && selectedItem && !selectedItem.isFolder) selectFile(selectedIndex);
          }}
          onFocusItem={(item) => setFocusedItem(itemIndex(item))}
          renderItem={({ item, title, arrow, children, context, depth }) => {
            const containerProps = children
              ? context.itemContainerWithChildrenProps
              : context.itemContainerWithoutChildrenProps;
            const interactiveElementProps = context.interactiveElementProps;
            return (
              <li
                {...containerProps}
                className={containerProps.className}
                style={{ ...containerProps.style, paddingLeft: depth * 14 }}
              >
                <div className="workspace-file-browser__tree-row">
                  {arrow}
                  <div
                    {...interactiveElementProps}
                    className={[
                      "workspace-file-browser__item",
                      context.isSelected && "workspace-file-browser__item-selected",
                      interactiveElementProps.className,
                    ].filter(Boolean).join(" ")}
                  >
                    {item.isFolder ? (expandedItems.includes(String(item.index)) ? <FolderOpen size={13} /> : <Folder size={13} />) : <File size={13} />}
                    <span>{title}</span>
                  </div>
                </div>
                {children}
              </li>
            );
          }}
        >
          <Tree treeId="workspace" rootItem={workspacePath} treeLabel={t("fileBrowser.treeLabel", { workspace: basename(workspacePath) })} />
        </ControlledTreeEnvironment>
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
          <WorkspaceFilePreview file={file} target={activeTarget} />
        ) : (
          <div className="workspace-file-browser__message">{t("fileBrowser.selectFile")}</div>
        )}
        {file?.truncated ? <div className="workspace-file-browser__status">{t("fileBrowser.truncated")}</div> : null}
      </div>
    </div>
  );
}
