import { File, Folder, FolderOpen, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import {
  ControlledTreeEnvironment,
  Tree,
} from "react-complex-tree";
import "react-complex-tree/lib/style.css";
import type { Extension } from "@uiw/react-codemirror";
import type { EditorView } from "@codemirror/view";
import {
  ancestorDirectories,
  basename,
  buildWorkspaceRoot,
  clampTargetColumn,
  clampTargetLine,
  itemIndex,
  languageForFile,
  mergeWorkspaceEntries,
  type WorkspaceEntry,
  type WorkspaceTreeItem,
} from "./workspace-file-browser-logic";
import "./workspace-file-browser.css";

interface WorkspaceApi {
  listWorkspaceEntries(input: { workspacePath: string; directoryPath: string }): Promise<WorkspaceEntry[]>;
  readWorkspaceFile(input: { workspacePath: string; filePath: string }): Promise<WorkspaceFile>;
}

export interface WorkspaceFile {
  path: string;
  name: string;
  size: number;
  kind: "text" | "image" | "audio" | "video" | "unsupported";
  mimeType?: string;
  content?: string;
  base64?: string;
  truncated?: boolean;
  reason?: string;
}

export interface WorkspaceFileBrowserProps {
  workspacePath: string;
  target?: { path: string; line?: number; column?: number; requestId: number; restricted?: boolean };
}

const LazyCodeMirror = lazy(async () => {
  const [{ default: CodeMirror }, { languages }, { EditorView, highlightActiveLine }] = await Promise.all([
    import("@uiw/react-codemirror"),
    import("@codemirror/language-data"),
    import("@codemirror/view"),
  ]);
  return {
    default: function WorkspaceCodeMirror({
      content,
      path,
      targetLine,
      targetColumn,
    }: {
      content: string;
      path: string;
      targetLine?: number;
      targetColumn?: number;
    }) {
      const [extension, setExtension] = useState<Extension | null>(null);
      const editorRef = useRef<EditorView | null>(null);
      const [theme, setTheme] = useState<"dark" | "light">(() =>
        document.documentElement.dataset.theme === "dark" ? "dark" : "light",
      );
      const scrollToTarget = useCallback((view: EditorView, lineNumber: number | undefined) => {
        if (lineNumber === undefined || lineNumber > view.state.doc.lines) return;
        const line = view.state.doc.line(lineNumber);
        const column = clampTargetColumn(targetColumn, line.length) ?? 1;
        const anchor = line.from + column - 1;
        view.dispatch({
          selection: { anchor },
          effects: EditorView.scrollIntoView(anchor, { y: "center" }),
        });
      }, [targetColumn]);
      useEffect(() => {
        setExtension(null);
        const language = languageForFile(path);
        const aliases: Record<string, string[]> = {
          tsx: ["tsx", "typescript jsx"],
          jsx: ["jsx", "javascript jsx"],
        };
        const names = language ? [language, ...(aliases[language] ?? [])] : [];
        const description = languages.find((item) => names.includes(item.name.toLowerCase()));
        let active = true;
        void description?.load().then((loaded) => {
          if (active) setExtension(loaded);
        });
        return () => {
          active = false;
        };
      }, [path]);
      useEffect(() => {
        const root = document.documentElement;
        const updateTheme = () => setTheme(root.dataset.theme === "dark" ? "dark" : "light");
        updateTheme();
        const observer = new MutationObserver(updateTheme);
        observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
        return () => observer.disconnect();
      }, []);
      useEffect(() => {
        if (editorRef.current) scrollToTarget(editorRef.current, targetLine);
      }, [content, path, scrollToTarget, targetColumn, targetLine]);
      return (
        <CodeMirror
          className="workspace-file-browser__editor"
          value={content}
          theme={theme}
          readOnly
          basicSetup
          extensions={extension ? [highlightActiveLine(), extension] : [highlightActiveLine()]}
          onCreateEditor={(view) => {
            editorRef.current = view;
            scrollToTarget(view, targetLine);
          }}
        />
      );
    },
  };
});

function dataUrl(file: WorkspaceFile): string | undefined {
  return file.base64 && file.mimeType ? `data:${file.mimeType};base64,${file.base64}` : undefined;
}

function Preview({ file, target }: { file: WorkspaceFile; target?: WorkspaceFileBrowserProps["target"] }) {
  const { t } = useTranslation();
  if (file.kind === "image" || file.kind === "audio" || file.kind === "video") {
    const src = dataUrl(file);
    if (!src) return <div className="workspace-file-browser__message">{t("fileBrowser.mediaMissing")}</div>;
    return (
      <div className="workspace-file-browser__media-wrap">
        {file.kind === "image" ? <img className="workspace-file-browser__media" src={src} alt={file.name} /> : null}
        {file.kind === "audio" ? <audio className="workspace-file-browser__audio" src={src} controls aria-label={file.name} /> : null}
        {file.kind === "video" ? <video className="workspace-file-browser__media" src={src} controls aria-label={file.name} /> : null}
      </div>
    );
  }
  if (file.kind === "unsupported") {
    return <div className="workspace-file-browser__message">{file.reason || t("fileBrowser.unsupported")}</div>;
  }
  const lines = (file.content ?? "").split(/\r?\n/).length;
  const targetLine = clampTargetLine(target?.line, lines);
  const selectedLineLength = targetLine === undefined ? undefined : (file.content ?? "").split(/\r?\n/)[targetLine - 1]?.length;
  const targetColumn = selectedLineLength === undefined ? undefined : clampTargetColumn(target?.column, selectedLineLength);
  return (
    <Suspense fallback={<div className="workspace-file-browser__message">{t("fileBrowser.loadingEditor")}</div>}>
      <LazyCodeMirror
        key={`${file.path}:${target?.requestId ?? 0}`}
        content={file.content ?? ""}
        path={file.path}
        {...(targetLine === undefined ? {} : { targetLine })}
        {...(targetColumn === undefined ? {} : { targetColumn })}
      />
    </Suspense>
  );
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
          <Preview file={file} target={activeTarget} />
        ) : (
          <div className="workspace-file-browser__message">{t("fileBrowser.selectFile")}</div>
        )}
        {file?.truncated ? <div className="workspace-file-browser__status">{t("fileBrowser.truncated")}</div> : null}
      </div>
    </div>
  );
}
