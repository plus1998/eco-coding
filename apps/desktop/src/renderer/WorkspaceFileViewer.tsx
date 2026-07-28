import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { basename } from "./workspace-file-browser-logic";
import {
  WorkspaceFilePreview,
  type WorkspaceFile,
  type WorkspaceFilePreviewTarget,
} from "./WorkspaceFilePreview";
import type { WorkspaceFileReference } from "./workspace-file-reference";
import "./workspace-file-browser.css";

interface WorkspaceApi {
  readWorkspaceFile(input: { workspacePath: string; filePath: string }): Promise<WorkspaceFile>;
}

export interface WorkspaceFileViewerProps {
  workspacePath: string;
  target?: WorkspaceFileReference & {
    requestId: number;
    restricted?: boolean;
  };
}

export function WorkspaceFileViewer({ workspacePath, target }: WorkspaceFileViewerProps) {
  const { t } = useTranslation();
  const api = window.eco as unknown as WorkspaceApi | undefined;
  const [file, setFile] = useState<WorkspaceFile | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestRef = useRef(0);

  const readFile = useCallback(async (
    fileTarget: NonNullable<WorkspaceFileViewerProps["target"]>,
    requestId: number,
  ) => {
    if (!api) {
      setErrorMessage(t("fileBrowser.apiUnavailable"));
      setStatus("error");
      return;
    }
    setStatus("loading");
    setErrorMessage(null);
    try {
      const result = await api.readWorkspaceFile({
        workspacePath,
        filePath: fileTarget.path,
      });
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

  useEffect(() => {
    const requestId = ++requestRef.current;
    setFile(null);
    setErrorMessage(null);
    if (!target || target.restricted) {
      setStatus("idle");
      return;
    }
    void readFile(target, requestId);
  }, [readFile, target]);

  const retry = () => {
    if (!target || target.restricted) return;
    const requestId = ++requestRef.current;
    void readFile(target, requestId);
  };

  const previewTarget: WorkspaceFilePreviewTarget | undefined = target
    ? {
        requestId: target.requestId,
        ...(target.line === undefined ? {} : { line: target.line }),
        ...(target.column === undefined ? {} : { column: target.column }),
      }
    : undefined;

  return (
    <div className="workspace-file-viewer">
      {target?.restricted ? (
        <div className="workspace-file-browser__message">{t("fileBrowser.restricted")}</div>
      ) : status === "loading" ? (
        <div className="workspace-file-browser__message">
          {t("fileBrowser.loadingFile", { name: basename(target?.path || "") })}
        </div>
      ) : status === "error" ? (
        <div className="workspace-file-browser__error">
          <p>{t("fileBrowser.readFailed")}: {errorMessage || t("fileBrowser.unknownError")}</p>
          <button type="button" onClick={retry} disabled={!target}>
            <RotateCcw size={13} aria-hidden="true" />
            {t("fileBrowser.retry")}
          </button>
        </div>
      ) : file ? (
        <WorkspaceFilePreview file={file} {...(previewTarget ? { target: previewTarget } : {})} />
      ) : (
        <div className="workspace-file-browser__message">{t("fileViewer.noFile")}</div>
      )}
      {file?.truncated ? <div className="workspace-file-browser__status">{t("fileBrowser.truncated")}</div> : null}
    </div>
  );
}
