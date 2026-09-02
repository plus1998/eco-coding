import { RotateCcw, Search } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceDiffFileStatus, WorkspaceDiffResult } from "../shared/ipc";
import { MaterialFileIcon } from "./MaterialFileIcon";
import { type ExplorerTreeItem, WorkspaceExplorerTree } from "./WorkspaceExplorerTree";

const ROOT_ID = "__workspace-diff-root__";

type DiffFile = WorkspaceDiffResult["files"][number];

interface DiffTreeItem extends ExplorerTreeItem {
  filePath?: string;
  file?: DiffFile;
}

interface WorkspaceDiffFileTreeProps {
  files: DiffFile[];
  rootLabel?: string;
  activePath?: string;
  discardBusy: boolean;
  onSelectPath: (path: string) => void;
  onDiscardPath?: (path: string) => void | Promise<void>;
}

function compactSingleChildDirectories(
  items: Record<string, DiffTreeItem>,
  expandedItems: string[],
  rootId: string,
): void {
  const visit = (id: string) => {
    const item = items[id];
    if (!item?.isFolder || !item.children) return;

    for (const childId of [...item.children]) {
      if (items[childId]?.isFolder) visit(childId);
    }

    while (item.children && item.children.length === 1) {
      const childId: string = item.children[0]!;
      const child: DiffTreeItem | undefined = items[childId];
      if (!child?.isFolder) break;
      item.data = `${item.data}/${child.data}`;
      item.children = child.children ?? [];
      delete items[childId];
      const expandedIndex = expandedItems.indexOf(childId);
      if (expandedIndex >= 0) expandedItems.splice(expandedIndex, 1);
    }
  };

  const root = items[rootId];
  if (!root?.children) return;
  for (const childId of [...root.children]) {
    if (items[childId]?.isFolder) visit(childId);
  }
}

export function buildDiffTree(
  files: DiffFile[],
  rootLabel = "Changes",
): {
  items: Record<string, DiffTreeItem>;
  expandedItems: string[];
  fileItemIds: Record<string, string>;
} {
  const items: Record<string, DiffTreeItem> = {
    [ROOT_ID]: {
      index: ROOT_ID,
      data: rootLabel,
      isFolder: true,
      children: [],
    },
  };
  const expandedItems = [ROOT_ID];
  const fileItemIds: Record<string, string> = {};

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    let parentId = ROOT_ID;
    let parentPath = "";

    segments.forEach((segment, segmentIndex) => {
      const isFile = segmentIndex === segments.length - 1;
      const currentPath = parentPath ? `${parentPath}/${segment}` : segment;
      const itemId = isFile ? `file:${file.path}` : `directory:${currentPath}`;
      if (!items[itemId]) {
        items[itemId] = isFile
          ? {
              index: itemId,
              data: segment,
              isFolder: false,
              filePath: file.path,
              file,
            }
          : {
              index: itemId,
              data: segment,
              isFolder: true,
              children: [],
            };
        if (!isFile) expandedItems.push(itemId);
      }
      const parent = items[parentId]!;
      if (parent.children && !parent.children.includes(itemId)) {
        parent.children.push(itemId);
      }
      parentId = itemId;
      parentPath = currentPath;
    });
    fileItemIds[file.path] = `file:${file.path}`;
  }

  compactSingleChildDirectories(items, expandedItems, ROOT_ID);
  return { items, expandedItems, fileItemIds };
}

function resolveFileStatus(file?: DiffFile): WorkspaceDiffFileStatus {
  return file?.status ?? "modified";
}

function statusMark(status: WorkspaceDiffFileStatus, isFolder: boolean): ReactNode {
  if (isFolder) {
    return <span className="workspace-diff-tree__folder-dot" aria-hidden />;
  }
  if (status === "untracked") {
    return <span className="workspace-diff-tree__git-mark is-untracked">U</span>;
  }
  if (status === "added") {
    return <span className="workspace-diff-tree__git-mark is-added">A</span>;
  }
  if (status === "deleted") {
    return <span className="workspace-diff-tree__git-mark is-deleted">D</span>;
  }
  return (
    <span className="workspace-diff-tree__git-mark is-modified" aria-hidden>
      <span />
    </span>
  );
}

export function WorkspaceDiffFileTree({
  files,
  rootLabel,
  activePath,
  discardBusy,
  onSelectPath,
  onDiscardPath,
}: WorkspaceDiffFileTreeProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [collapsedItems, setCollapsedItems] = useState<string[]>([]);
  const filteredFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return files;
    return files.filter((file) => file.path.toLowerCase().includes(normalizedQuery));
  }, [files, query]);
  const tree = useMemo(() => buildDiffTree(filteredFiles, rootLabel), [filteredFiles, rootLabel]);
  const expandedItems = useMemo(
    () => tree.expandedItems.filter((index) => !collapsedItems.includes(index)),
    [collapsedItems, tree.expandedItems],
  );
  const selectedItemId = activePath ? tree.fileItemIds[activePath] : undefined;
  const selectedItems = selectedItemId ? [selectedItemId] : [];

  return (
    <div className="workspace-diff-tree">
      <label className="workspace-diff-tree__search">
        <Search size={14} aria-hidden />
        <input
          type="search"
          value={query}
          placeholder={t("workspace.diff.filterFiles")}
          aria-label={t("workspace.diff.filterFiles")}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button
            type="button"
            className="workspace-diff-tree__clear"
            aria-label={t("common.clear")}
            title={t("common.clear")}
            onClick={() => setQuery("")}
          >
            ×
          </button>
        ) : null}
      </label>
      {files.length === 0 || filteredFiles.length === 0 ? (
        <p className="workspace-diff-drawer-files-empty">{t("workspace.diff.noMatchingFiles")}</p>
      ) : (
        <div className="workspace-diff-tree__scroll">
          <WorkspaceExplorerTree
            items={tree.items}
            rootItem={ROOT_ID}
            expandedItems={expandedItems}
            selectedItems={selectedItems}
            focusedItem={selectedItems[0] ?? ROOT_ID}
            treeLabel={t("workspace.diff.files")}
            hideRoot
            className="workspace-diff-tree__explorer"
            renderLeading={(item) => {
              const treeItem = item as DiffTreeItem;
              if (treeItem.isFolder) return null;
              return (
                <MaterialFileIcon
                  path={treeItem.filePath ?? treeItem.data}
                  size={16}
                  className="workspace-diff-tree__file-icon"
                />
              );
            }}
            renderTrailing={(item) => {
              const treeItem = item as DiffTreeItem;
              const status = resolveFileStatus(treeItem.file);
              return (
                <>
                  {statusMark(status, Boolean(treeItem.isFolder))}
                  {treeItem.filePath && onDiscardPath ? (
                    <button
                      type="button"
                      className="workspace-diff-tree__discard"
                      aria-label={t("workspace.diff.discardFile", { path: treeItem.filePath })}
                      title={t("workspace.diff.discardFileTitle")}
                      disabled={discardBusy}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onDiscardPath(treeItem.filePath!);
                      }}
                    >
                      <RotateCcw size={13} aria-hidden />
                    </button>
                  ) : null}
                </>
              );
            }}
            onExpandItem={(index) => {
              setCollapsedItems((current) => current.filter((value) => value !== index));
            }}
            onCollapseItem={(index) => {
              setCollapsedItems((current) => [...new Set([...current, index])]);
            }}
            onSelectItem={(index) => {
              const selectedItem = tree.items[index];
              if (selectedItem?.filePath) onSelectPath(selectedItem.filePath);
            }}
          />
        </div>
      )}
    </div>
  );
}
