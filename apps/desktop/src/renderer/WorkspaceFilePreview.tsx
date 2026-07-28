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

export function WorkspaceFilePreview({
  file,
  target,
}: {
  file: WorkspaceFile;
  target?: WorkspaceFilePreviewTarget;
}) {
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
