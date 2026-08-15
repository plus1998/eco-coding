import { useTranslation } from "react-i18next";
import { AcpModelCascade } from "./AcpModelCascade";
import type { AcpModelOption } from "../shared/acp-model-vendor";

interface AcpModelSettingsDialogProps {
  models: readonly AcpModelOption[];
  selectedModelId?: string;
  loading?: boolean;
  error?: string;
  busy?: boolean;
  title?: string;
  /** Test-only: start with a search query. */
  initialQuery?: string;
  onChange: (modelId: string | undefined) => void;
  onRefresh?: () => void;
  onClose: () => void;
}

export function AcpModelSettingsDialog({
  models,
  selectedModelId,
  loading = false,
  error,
  busy,
  title,
  initialQuery = "",
  onChange,
  onRefresh,
  onClose,
}: AcpModelSettingsDialogProps) {
  const { t } = useTranslation();

  return (
    <div className="settings-modal-backdrop" onClick={onClose}>
      <div
        className="settings-modal acp-model-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="acp-model-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-modal-header">
          <h2 id="acp-model-settings-title" className="settings-modal-title">
            {title ?? t("settings.acpModel.title")}
          </h2>
        </header>
        <div className="settings-modal-body">
          <AcpModelCascade
            models={models}
            {...(selectedModelId ? { selectedModelId } : {})}
            loading={loading}
            {...(error ? { error } : {})}
            {...(busy ? { busy } : {})}
            initialQuery={initialQuery}
            onChange={onChange}
            onClose={onClose}
          />
        </div>
        <footer className="settings-modal-footer">
          <button type="button" className="settings-modal-cancel" onClick={onClose}>
            {t("common.close")}
          </button>
          <div className="settings-modal-footer-actions">
            {onRefresh ? (
              <button
                type="button"
                className="settings-modal-cancel"
                onClick={onRefresh}
                disabled={busy || loading}
              >
                {t("common.refresh")}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
