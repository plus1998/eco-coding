import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { AcpModelOption } from "../shared/acp-model-vendor";
import { resolveAcpComposerTriggerLabel } from "../shared/acp-model-vendor";
import { AcpModelCascade } from "./AcpModelCascade";
import { composerFloatingStyleForAnchor } from "./composer-floating";

export interface ComposerAcpModelTriggerProps {
  models: readonly AcpModelOption[];
  selectedModelId?: string;
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  onOpen?: () => void;
  onChange: (modelId: string | undefined) => void;
}

export function ComposerAcpModelTrigger({
  models,
  selectedModelId,
  disabled,
  loading,
  error,
  onOpen,
  onChange,
}: ComposerAcpModelTriggerProps) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() => ({ visibility: "hidden" }));
  const triggerLabel = resolveAcpComposerTriggerLabel(
    models,
    selectedModelId,
    t("settings.acpModel.default"),
  );

  const updatePanelPosition = useCallback(() => {
    const anchor = triggerRef.current;
    if (!anchor) {
      return;
    }
    setPanelStyle(
      composerFloatingStyleForAnchor(anchor, {
        width: 560,
        minHeight: 280,
        prefer: "above",
        align: "start",
        fixedHeight: 420,
      }),
    );
  }, []);

  const closePanel = useCallback(() => {
    setOpen(false);
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
    onOpen?.();
  }, [onOpen]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      closePanel();
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, closePanel]);

  const popover =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            className="composer-codex-popover composer-acp-model-popover"
            role="dialog"
            aria-label={t("settings.acpModel.title")}
            style={panelStyle}
          >
            <AcpModelCascade
              models={models}
              {...(selectedModelId ? { selectedModelId } : {})}
              {...(loading ? { loading } : {})}
              {...(error ? { error } : {})}
              {...(disabled ? { busy: disabled } : {})}
              onChange={(modelId) => {
                onChange(modelId);
                closePanel();
              }}
              onClose={closePanel}
            />
          </div>,
          document.body,
        )
      : null;

  return (
    <span className="composer-model-selector">
      <button
        ref={triggerRef}
        type="button"
        className={["composer-model-trigger", open ? "is-active" : ""].filter(Boolean).join(" ")}
        disabled={disabled}
        aria-label={t("composer.model.triggerAria", { label: triggerLabel })}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-busy={loading || undefined}
        title={triggerLabel}
        onClick={() => {
          if (open) {
            closePanel();
          } else {
            openPanel();
          }
        }}
      >
        <span className="composer-model-label is-medium">
          <span className="composer-model-label-name">{triggerLabel}</span>
        </span>
      </button>
      {popover}
    </span>
  );
}
