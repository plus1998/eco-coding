import { useTranslation } from "react-i18next";
import type { AcpModelOption } from "../shared/acp-model-vendor";
import {
  createAcpCurrentExtra,
  mapAcpModelOptions,
  resolveAcpVendorNames,
} from "./model-cascade-options";
import { ModelCascadeSelect } from "./ModelCascadeSelect";
import { useMemo } from "react";

export interface ComposerAcpModelTriggerProps {
  models: readonly AcpModelOption[];
  selectedModelId?: string;
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  onOpen?: () => void;
  onChange: (modelId: string | undefined) => void;
}

/**
 * Cursor ACP model selection in the composer. Built on the unified
 * `ModelCascadeSelect` so it keeps the vendor → model hierarchy and search
 * instead of a flat model list.
 */
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
  const vendorNames = useMemo(() => resolveAcpVendorNames(t), [t]);
  const options = useMemo(() => mapAcpModelOptions(models, vendorNames), [models, vendorNames]);
  const currentExtra = useMemo(
    () => createAcpCurrentExtra(models, t("settings.acpModel.current")),
    [models, t],
  );
  const value = selectedModelId
    ? { key: selectedModelId, providerId: "", modelId: selectedModelId }
    : undefined;
  const selectedModel = models.find((model) => model.id === selectedModelId);

  return (
    <span className="composer-model-selector">
      <ModelCascadeSelect
        options={options}
        value={value}
        loading={loading}
        error={error}
        disabled={disabled}
        clearable
        clearLabel={t("settings.acpModel.default")}
        placeholder={selectedModel?.displayName ?? t("settings.acpModel.default")}
        hint={t("settings.acpModel.defaultHint")}
        triggerClassName="composer-model-trigger composer-acp-model-trigger"
        onOpen={onOpen}
        renderExtra={currentExtra}
        onChange={(selection) => onChange(selection?.key ?? undefined)}
      />
    </span>
  );
}
