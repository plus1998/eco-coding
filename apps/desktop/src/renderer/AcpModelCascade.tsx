import { Check, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ACP_MODEL_VENDOR_ICONS,
  ACP_MODEL_VENDORS,
  type AcpModelOption,
  type AcpModelVendor,
  filterAcpModels,
  groupAcpModelsByVendor,
  resolveAcpModelVendor,
} from "../shared/acp-model-vendor";
import type { I18nKey } from "../shared/i18n-catalogs";

export interface AcpModelCascadeProps {
  models: readonly AcpModelOption[];
  selectedModelId?: string;
  loading?: boolean;
  error?: string;
  busy?: boolean;
  /** Test-only: start with a search query. */
  initialQuery?: string;
  onChange: (modelId: string | undefined) => void;
  onClose?: () => void;
}

const VENDOR_LABEL_KEYS: Record<AcpModelVendor, I18nKey> = {
  anthropic: "settings.acpModel.vendor.anthropic",
  gpt: "settings.acpModel.vendor.gpt",
  grok: "settings.acpModel.vendor.grok",
  google: "settings.acpModel.vendor.google",
  other: "settings.acpModel.vendor.other",
};

export function AcpModelCascade({
  models,
  selectedModelId,
  loading = false,
  error,
  busy,
  initialQuery = "",
  onChange,
  onClose,
}: AcpModelCascadeProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(initialQuery);
  const grouped = useMemo(() => groupAcpModelsByVendor(models), [models]);
  const [activeVendor, setActiveVendor] = useState<AcpModelVendor>(() =>
    resolveAcpModelVendor(selectedModelId, models),
  );
  const selectedId = selectedModelId ?? "";
  const needle = query.trim();
  const searching = needle.length > 0;
  const visibleModels = useMemo(
    () => (searching ? filterAcpModels(models, needle) : grouped[activeVendor]),
    [searching, models, needle, grouped, activeVendor],
  );
  const vendorCounts = useMemo(
    () => (searching ? groupAcpModelsByVendor(visibleModels) : grouped),
    [searching, visibleModels, grouped],
  );
  const showDefault =
    !searching || t("settings.acpModel.default").toLowerCase().includes(needle.toLowerCase());

  useEffect(() => {
    setActiveVendor(resolveAcpModelVendor(selectedModelId, models));
  }, [selectedModelId, models]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (query.trim()) {
        setQuery("");
        return;
      }
      onClose?.();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, query]);

  return (
    <div className="acp-model-cascade-shell">
      <label className="acp-model-cascade-search">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder={t("settings.acpModel.searchPlaceholder")}
          aria-label={t("settings.acpModel.searchPlaceholder")}
          disabled={busy || loading}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="acp-model-cascade">
        <div
          className="acp-model-cascade-vendors"
          role="listbox"
          aria-label={t("settings.acpModel.vendors")}
        >
          {ACP_MODEL_VENDORS.map((vendor) => {
            const selected = vendor === activeVendor;
            return (
              <button
                key={vendor}
                type="button"
                role="option"
                aria-selected={selected}
                className={
                  selected ? "acp-model-cascade-vendor is-selected" : "acp-model-cascade-vendor"
                }
                onClick={() => {
                  setActiveVendor(vendor);
                  if (searching) setQuery("");
                }}
              >
                <img
                  className="acp-model-cascade-vendor-icon"
                  src={ACP_MODEL_VENDOR_ICONS[vendor]}
                  alt=""
                  aria-hidden="true"
                />
                <span className="acp-model-cascade-vendor-name">{t(VENDOR_LABEL_KEYS[vendor])}</span>
                <span className="acp-model-cascade-vendor-count">{vendorCounts[vendor].length}</span>
              </button>
            );
          })}
        </div>
        <div
          className="acp-model-cascade-models"
          role="listbox"
          aria-label={t("settings.acpModel.models")}
        >
          {showDefault ? (
            <button
              type="button"
              role="option"
              aria-selected={selectedId === ""}
              className={
                selectedId === ""
                  ? "acp-model-cascade-model is-selected"
                  : "acp-model-cascade-model"
              }
              disabled={busy || loading}
              onClick={() => onChange(undefined)}
            >
              <span className="acp-model-cascade-model-body">
                <strong>{t("settings.acpModel.default")}</strong>
                <small>{t("settings.acpModel.defaultHint")}</small>
              </span>
              <span className="acp-model-cascade-model-state" aria-hidden>
                {selectedId === "" ? <Check size={15} /> : null}
              </span>
            </button>
          ) : null}
          {visibleModels.map((model) => {
            const selected = model.id === selectedId;
            return (
              <button
                key={model.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={
                  selected ? "acp-model-cascade-model is-selected" : "acp-model-cascade-model"
                }
                disabled={busy || loading}
                onClick={() => onChange(model.id)}
              >
                <span className="acp-model-cascade-model-body">
                  <strong>{model.displayName}</strong>
                  <small>
                    {model.current
                      ? `${model.id} · ${t("settings.acpModel.current")}`
                      : model.id}
                  </small>
                </span>
                <span className="acp-model-cascade-model-state" aria-hidden>
                  {selected ? <Check size={15} /> : null}
                </span>
              </button>
            );
          })}
          {visibleModels.length === 0 ? (
            <p className="acp-model-cascade-empty">
              {searching ? t("settings.acpModel.noMatches") : t("settings.acpModel.emptyVendor")}
            </p>
          ) : null}
        </div>
      </div>
      {loading ? <p className="acp-model-settings-status">{t("settings.acpModel.loading")}</p> : null}
      {error ? (
        <p className="acp-model-settings-status is-error">
          {t("settings.acpModel.loadError", { error })}
        </p>
      ) : null}
    </div>
  );
}
