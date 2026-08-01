import type { Extension } from "@uiw/react-codemirror";
import type { EditorView } from "@codemirror/view";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  clampTargetColumn,
  clampTargetLine,
  languageForFile,
} from "./workspace-file-browser-logic";

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

export interface WorkspaceFilePreviewTarget {
  line?: number;
  column?: number;
  requestId: number;
}

interface WorkspaceWriteApi {
  writeWorkspaceFile(input: {
    workspacePath: string;
    filePath: string;
    content: string;
  }): Promise<{ path: string; name: string; size: number }>;
}

const LazyCodeMirror = lazy(async () => {
  const [
    { default: CodeMirror },
    { languages },
    { EditorView, highlightActiveLine, keymap },
    { HighlightStyle, syntaxHighlighting },
    { tags },
    { buildWorkspaceDiffMergeExtensions },
  ] = await Promise.all([
    import("@uiw/react-codemirror"),
    import("@codemirror/language-data"),
    import("@codemirror/view"),
    import("@codemirror/language"),
    import("@lezer/highlight"),
    import("./workspace-diff-merge-extensions"),
  ]);
  const softLightHighlighting = syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.comment, color: "#8a9a8f", fontStyle: "italic" },
      { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword], color: "#8b5fbf" },
      { tag: [tags.variableName, tags.definition(tags.variableName)], color: "#b16b45" },
      { tag: [tags.string, tags.special(tags.string)], color: "#5d9165" },
      { tag: [tags.number, tags.bool, tags.atom, tags.null], color: "#4387c5" },
      { tag: [tags.typeName, tags.className, tags.namespace], color: "#7167a8" },
      { tag: [tags.function(tags.variableName)], color: "#587aa3" },
      { tag: [tags.propertyName, tags.labelName], color: "#a06f4d" },
      { tag: [tags.operator, tags.punctuation], color: "#4e83b5" },
      { tag: [tags.meta, tags.annotation], color: "#8870a7" },
      { tag: tags.invalid, color: "#b65f68" },
    ]),
  );

  function buildMergeExtensions(
    originalContent: string | undefined,
    merge: boolean | undefined,
    mergePhrases: Record<string, string> | undefined,
  ) {
    if (!merge || originalContent === undefined) return [];
    return buildWorkspaceDiffMergeExtensions({
      originalContent,
      ...(mergePhrases ? { phrases: mergePhrases } : {}),
    });
  }

  return {
    default: function WorkspaceCodeMirror({
      content,
      path,
      targetLine,
      targetColumn,
      className,
      originalContent,
      merge,
      mergePhrases,
      readOnly = true,
      onChange,
      onSave,
    }: {
      content: string;
      path: string;
      targetLine?: number;
      targetColumn?: number;
      className?: string;
      originalContent?: string;
      merge?: boolean;
      mergePhrases?: Record<string, string>;
      readOnly?: boolean;
      onChange?: (value: string) => void;
      onSave?: () => void;
    }) {
      const [extension, setExtension] = useState<Extension | null>(null);
      const editorRef = useRef<EditorView | null>(null);
      const onSaveRef = useRef(onSave);
      onSaveRef.current = onSave;
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
      const saveKeymap = keymap.of([
        {
          key: "Mod-s",
          run: () => {
            onSaveRef.current?.();
            return true;
          },
          preventDefault: true,
        },
      ]);
      const editableExtensions = [
        EditorView.lineWrapping,
        ...(merge ? [] : [highlightActiveLine()]),
        theme === "light" ? softLightHighlighting : [],
        ...buildMergeExtensions(originalContent, merge, mergePhrases),
        ...(readOnly ? [] : [saveKeymap]),
        ...(extension ? [extension] : []),
      ];
      return (
        <CodeMirror
          className={className ?? "workspace-file-browser__editor"}
          value={content}
          theme={theme}
          readOnly={readOnly}
          basicSetup={{
            foldGutter: false,
            foldKeymap: false,
          }}
          extensions={editableExtensions}
          onChange={onChange}
          onCreateEditor={(view) => {
            editorRef.current = view;
            scrollToTarget(view, targetLine);
          }}
        />
      );
    },
  };
});

export interface WorkspaceCodeMirrorProps {
  content: string;
  path: string;
  targetLine?: number;
  targetColumn?: number;
  className?: string;
  originalContent?: string;
  merge?: boolean;
  mergePhrases?: Record<string, string>;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onSave?: () => void;
}

export const WorkspaceCodeMirror = LazyCodeMirror;

function dataUrl(file: WorkspaceFile): string | undefined {
  return file.base64 && file.mimeType ? `data:${file.mimeType};base64,${file.base64}` : undefined;
}

export function WorkspaceFilePreview({
  file,
  target,
  workspacePath,
  onDirtyChange,
}: {
  file: WorkspaceFile;
  target?: WorkspaceFilePreviewTarget;
  workspacePath?: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const editable = file.kind === "text" && !file.truncated && Boolean(workspacePath);
  const baselineRef = useRef(file.content ?? "");
  const [draft, setDraft] = useState(file.content ?? "");
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const savingRef = useRef(false);
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;

  useEffect(() => {
    const next = file.content ?? "";
    baselineRef.current = next;
    setDraft(next);
    setDirty(false);
    setSaveStatus("idle");
    setSaveError(null);
    onDirtyChangeRef.current?.(false);
  }, [file.content, file.path, target?.requestId]);

  const updateDirty = useCallback((nextDraft: string) => {
    const nextDirty = nextDraft !== baselineRef.current;
    setDirty(nextDirty);
    onDirtyChangeRef.current?.(nextDirty);
  }, []);

  const handleChange = useCallback(
    (value: string) => {
      setDraft(value);
      updateDirty(value);
      if (saveStatus === "error") {
        setSaveStatus("idle");
        setSaveError(null);
      }
    },
    [saveStatus, updateDirty],
  );

  const handleSave = useCallback(async () => {
    if (!editable || !workspacePath || savingRef.current) return;
    if (draftRef.current === baselineRef.current) return;
    const api = window.eco as unknown as WorkspaceWriteApi | undefined;
    if (!api?.writeWorkspaceFile) {
      setSaveStatus("error");
      setSaveError(t("fileBrowser.apiUnavailable"));
      return;
    }
    savingRef.current = true;
    setSaveStatus("saving");
    setSaveError(null);
    const contentToSave = draftRef.current;
    try {
      await api.writeWorkspaceFile({
        workspacePath,
        filePath: file.path,
        content: contentToSave,
      });
      baselineRef.current = contentToSave;
      setDirty(false);
      onDirtyChangeRef.current?.(false);
      setSaveStatus("idle");
    } catch (error) {
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : t("fileBrowser.unknownError"));
    } finally {
      savingRef.current = false;
    }
  }, [editable, file.path, t, workspacePath]);

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
  const lines = draft.split(/\r?\n/).length;
  const targetLine = clampTargetLine(target?.line, lines);
  const selectedLineLength = targetLine === undefined ? undefined : draft.split(/\r?\n/)[targetLine - 1]?.length;
  const targetColumn = selectedLineLength === undefined ? undefined : clampTargetColumn(target?.column, selectedLineLength);
  const statusMessage =
    saveStatus === "saving"
      ? t("fileBrowser.saving")
      : saveStatus === "error"
        ? `${t("fileBrowser.saveFailed")}: ${saveError || t("fileBrowser.unknownError")}`
        : dirty
          ? t("fileBrowser.unsaved")
          : null;
  return (
    <div className="workspace-file-browser__preview-body">
      <Suspense fallback={<div className="workspace-file-browser__message">{t("fileBrowser.loadingEditor")}</div>}>
        <WorkspaceCodeMirror
          key={`${file.path}:${target?.requestId ?? 0}`}
          content={draft}
          path={file.path}
          readOnly={!editable}
          onChange={editable ? handleChange : undefined}
          onSave={editable ? () => void handleSave() : undefined}
          {...(targetLine === undefined ? {} : { targetLine })}
          {...(targetColumn === undefined ? {} : { targetColumn })}
        />
      </Suspense>
      {statusMessage ? (
        <div
          className={[
            "workspace-file-browser__status",
            saveStatus === "error" ? "is-error" : "",
            dirty && saveStatus !== "error" ? "is-dirty" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          role="status"
        >
          {statusMessage}
        </div>
      ) : null}
    </div>
  );
}
