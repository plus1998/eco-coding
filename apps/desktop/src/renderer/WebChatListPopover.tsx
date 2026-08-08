import { Plus, Trash2, X } from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { WebChatItem, WebChatListSnapshot, WebChatListView } from "../shared/web-chat-list";
import {
  createCustomWebChatItem,
  normalizeWebChatListSnapshot,
  removeCustomWebChatItem,
  webChatHostname,
} from "../shared/web-chat-list";
import { webChatListPopoverBoxForRect } from "./web-chat-list-popover-layout";

export interface WebChatListPopoverProps {
  open: boolean;
  items: WebChatItem[];
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelect: (item: WebChatItem) => void;
  onListChange: (view: WebChatListView) => void;
}

function customsSnapshotFromItems(items: WebChatItem[]): WebChatListSnapshot {
  return normalizeWebChatListSnapshot({
    customs: items.filter((item) => !item.builtin),
  });
}

function panelStyleFromAnchor(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  return webChatListPopoverBoxForRect(rect, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
}

export function WebChatListPopover({
  open,
  items,
  anchorRef,
  onClose,
  onSelect,
  onListChange,
}: WebChatListPopoverProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() => ({ visibility: "hidden" }));
  const [adding, setAdding] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [formError, setFormError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const updatePanelPosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }
    setPanelStyle(panelStyleFromAnchor(anchor));
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle({ visibility: "hidden" });
      setAdding(false);
      setDraftTitle("");
      setDraftUrl("");
      setFormError(undefined);
      return;
    }
    updatePanelPosition();
    const raf = window.requestAnimationFrame(() => updatePanelPosition());
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) {
      return;
    }
    // Use pointerdown capture so we do not race the opening click, and ignore
    // the same-tick activation path of the topbar toggle.
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) {
        return;
      }
      onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef, onClose, open]);

  const persist = useCallback(
    async (next: WebChatListSnapshot) => {
      if (!window.eco?.saveWebChatList) {
        throw new Error("web chat list API unavailable");
      }
      setSaving(true);
      try {
        const view = await window.eco.saveWebChatList(next);
        onListChange(view);
        return view;
      } finally {
        setSaving(false);
      }
    },
    [onListChange],
  );

  const handleAdd = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setFormError(undefined);
      const created = createCustomWebChatItem(
        { title: draftTitle, url: draftUrl },
        customsSnapshotFromItems(items),
      );
      if (!created.ok) {
        if (created.reason === "invalid_title") {
          setFormError(t("app.webChat.invalidTitle"));
        } else if (created.reason === "invalid_url") {
          setFormError(t("app.webChat.invalidUrl"));
        } else {
          setFormError(t("app.webChat.duplicateUrl"));
        }
        return;
      }
      try {
        await persist(created.next);
        setDraftTitle("");
        setDraftUrl("");
        setAdding(false);
      } catch (caught) {
        setFormError(caught instanceof Error ? caught.message : t("app.webChat.saveFailed"));
      }
    },
    [draftTitle, draftUrl, items, persist, t],
  );

  const handleRemove = useCallback(
    async (item: WebChatItem) => {
      if (item.builtin) {
        return;
      }
      try {
        await persist(removeCustomWebChatItem(item.id, customsSnapshotFromItems(items)));
      } catch {
        // keep list as-is; surface nothing beyond silent refusal
      }
    },
    [items, persist],
  );

  if (!open) {
    return null;
  }

  const popover = (
    <div
      ref={panelRef}
      className="web-chat-list-popover"
      style={panelStyle}
      role="dialog"
      aria-label={t("app.webChat.listTitle")}
    >
      <div className="web-chat-list-popover-header">
        <span className="web-chat-list-popover-title">{t("app.webChat.listTitle")}</span>
        <button
          type="button"
          className="web-chat-list-popover-icon-btn"
          onClick={onClose}
          aria-label={t("app.webChat.close")}
        >
          <X size={14} aria-hidden />
        </button>
      </div>
      <div className="web-chat-list-popover-list" role="list">
        {items.length === 0 ? (
          <p className="web-chat-list-empty">{t("app.webChat.empty")}</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="web-chat-list-row" role="listitem">
              <button
                type="button"
                className="web-chat-list-item"
                onClick={() => {
                  onSelect(item);
                  onClose();
                }}
              >
                <span className="web-chat-list-item-title">{item.title}</span>
                <span className="web-chat-list-item-desc">{webChatHostname(item.url)}</span>
              </button>
              {!item.builtin ? (
                <button
                  type="button"
                  className="web-chat-list-popover-icon-btn web-chat-list-remove"
                  onClick={() => void handleRemove(item)}
                  disabled={saving}
                  title={t("app.webChat.remove")}
                  aria-label={t("app.webChat.removeNamed", { title: item.title })}
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
      {adding ? (
        <form className="web-chat-list-add-form" onSubmit={(event) => void handleAdd(event)}>
          <label className="web-chat-list-field">
            <span>{t("app.webChat.nameLabel")}</span>
            <input
              type="text"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              placeholder={t("app.webChat.namePlaceholder")}
              autoFocus
              maxLength={80}
            />
          </label>
          <label className="web-chat-list-field">
            <span>{t("app.webChat.urlLabel")}</span>
            <input
              type="text"
              value={draftUrl}
              onChange={(event) => setDraftUrl(event.target.value)}
              placeholder={t("app.webChat.urlPlaceholder")}
              maxLength={500}
            />
          </label>
          {formError ? <p className="web-chat-list-form-error">{formError}</p> : null}
          <div className="web-chat-list-add-actions">
            <button type="button" className="web-chat-list-secondary-btn" onClick={() => setAdding(false)}>
              {t("app.webChat.cancel")}
            </button>
            <button type="submit" className="web-chat-list-primary-btn" disabled={saving}>
              {t("app.webChat.save")}
            </button>
          </div>
        </form>
      ) : (
        <div className="web-chat-list-footer">
          <button
            type="button"
            className="web-chat-list-add-btn"
            onClick={() => {
              setAdding(true);
              setFormError(undefined);
            }}
          >
            <Plus size={14} aria-hidden />
            <span>{t("app.webChat.add")}</span>
          </button>
        </div>
      )}
    </div>
  );

  return createPortal(popover, document.body);
}
