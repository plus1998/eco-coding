import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { i18n } from "./i18n";

export function ImageLightbox({
  src,
  alt,
  title,
  dialogLabel,
  onClose,
}: {
  src: string;
  alt: string;
  title: string;
  dialogLabel: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
        <img src={src} alt={alt} />
      </div>
    </div>,
    document.body,
  );
}
