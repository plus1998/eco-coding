export interface AuxiliaryModelSelection {
  providerId: string;
  modelId: string;
  candidateModelId: string;
}

export function isAuxiliaryModelSelection(value: unknown): value is AuxiliaryModelSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.providerId === "string" &&
    Boolean(record.providerId.trim()) &&
    typeof record.modelId === "string" &&
    Boolean(record.modelId.trim()) &&
    typeof record.candidateModelId === "string" &&
    Boolean(record.candidateModelId.trim())
  );
}

export function normalizeAuxiliaryModelSelection(value: unknown): AuxiliaryModelSelection | undefined {
  if (!isAuxiliaryModelSelection(value)) {
    return undefined;
  }
  return {
    providerId: value.providerId.trim(),
    modelId: value.modelId.trim(),
    candidateModelId: value.candidateModelId.trim(),
  };
}
