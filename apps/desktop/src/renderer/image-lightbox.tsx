import { FolderOpen, Minus, Plus, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { i18n } from "./i18n";
import {
  attachLightboxZoom,
  formatLightboxZoomPercent,
  LIGHTBOX_ZOOM_DEFAULT,
  type LightboxZoomController,
  type LightboxZoomTransform,
} from "./lightbox-zoom";

export function ImageLightbox({
  src,
  alt,
  title,
  dialogLabel,
  onOpenFolder,
  onClose,
}: {
  src: string;
  alt: string;
  title: string;
  dialogLabel: string;
  /** 可选：图片对应本地文件时提供，用于在文件管理器中显示所在文件夹。 */
  onOpenFolder?: () => void;
  onClose: () => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef<LightboxZoomController | null>(null);
  const [transform, setTransform] = useState<LightboxZoomTransform>({
    scale: LIGHTBOX_ZOOM_DEFAULT,
    x: 0,
    y: 0,
  });

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      const zoom = zoomRef.current;
      if (!zoom) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoom.zoomIn();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoom.zoomOut();
      } else if (event.key === "0") {
        event.preventDefault();
        zoom.reset();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const controller = attachLightboxZoom({
      stage,
      canvas,
      onChange: setTransform,
    });
    zoomRef.current = controller;
    return () => {
      controller.destroy();
      zoomRef.current = null;
    };
  }, [src]);

  const zoomIn = useCallback(() => zoomRef.current?.zoomIn(), []);
  const zoomOut = useCallback(() => zoomRef.current?.zoomOut(), []);
  const resetZoom = useCallback(() => zoomRef.current?.reset(), []);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="run-log-image-view-lightbox"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="run-log-image-view-lightbox-content"
        role="dialog"
        aria-modal="true"
        aria-label={dialogLabel}
      >
        <div className="run-log-image-view-lightbox-bar">
          <span title={title}>{title}</span>
          <div className="lightbox-zoom-controls">
            <button
              type="button"
              className="run-log-image-view-lightbox-close"
              onClick={zoomOut}
              title={i18n.t("lightbox.zoomOut")}
              aria-label={i18n.t("lightbox.zoomOut")}
            >
              <Minus size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="lightbox-zoom-percent"
              onClick={resetZoom}
              title={i18n.t("lightbox.zoomReset")}
              aria-label={i18n.t("lightbox.zoomReset")}
            >
              {formatLightboxZoomPercent(transform.scale)}
            </button>
            <button
              type="button"
              className="run-log-image-view-lightbox-close"
              onClick={zoomIn}
              title={i18n.t("lightbox.zoomIn")}
              aria-label={i18n.t("lightbox.zoomIn")}
            >
              <Plus size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="run-log-image-view-lightbox-close"
              onClick={resetZoom}
              title={i18n.t("lightbox.zoomReset")}
              aria-label={i18n.t("lightbox.zoomReset")}
            >
              <RotateCcw size={15} aria-hidden />
            </button>
            {onOpenFolder ? (
              <button
                type="button"
                className="run-log-image-view-lightbox-close"
                onClick={onOpenFolder}
                title={i18n.t("lightbox.openFolder")}
                aria-label={i18n.t("lightbox.openFolder")}
              >
                <FolderOpen size={16} aria-hidden />
              </button>
            ) : null}
            <button
              type="button"
              className="run-log-image-view-lightbox-close"
              onClick={onClose}
              title={i18n.t("common.close")}
              aria-label={i18n.t("common.close")}
            >
              <X size={18} aria-hidden />
            </button>
          </div>
        </div>
        <div ref={stageRef} className="run-log-image-view-lightbox-stage lightbox-zoom-stage">
          <div ref={canvasRef} className="lightbox-zoom-canvas">
            <img src={src} alt={alt} draggable={false} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
