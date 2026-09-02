import type { AcpSessionModeId } from "./acp-types.js";

export type AcpAvailableModel = {
  modelId: string;
  name?: string;
};

/**
 * Map Composer / CLI model ids onto ACP wire ids from `session/new` or `session/load` models.
 * Exact modelId wins; otherwise match by name or bare id before `[…]`.
 * Throws when the catalog is missing or the id cannot be mapped — never pass CLI short
 * names like `auto` / `composer-2.5` through to `session/set_model`.
 */
export function resolveAcpWireModelId(
  requested: string,
  available: readonly AcpAvailableModel[] = [],
): string {
  const trimmed = requested.trim();
  if (!trimmed) return trimmed;
  if (available.length === 0) {
    throw new Error(
      `ACP availableModels missing; cannot resolve model id "${trimmed}" to a wire id (CLI short names like "auto" are not valid for session/set_model)`,
    );
  }
  if (available.some((m) => m.modelId === trimmed)) {
    return trimmed;
  }
  if (trimmed === "auto") {
    const auto = available.find((m) => m.modelId === "default[]" || m.name?.toLowerCase() === "auto");
    if (auto) return auto.modelId;
  }
  const bare = trimmed.replace(/\[.*$/, "");
  const byBare = available.find(
    (m) =>
      m.modelId === `${bare}[]` || m.modelId.startsWith(`${bare}[`) || m.name === trimmed || m.name === bare,
  );
  if (byBare) return byBare.modelId;
  const sample = available
    .slice(0, 5)
    .map((m) => m.modelId)
    .join(", ");
  throw new Error(
    `ACP model id "${trimmed}" is not in availableModels (e.g. ${sample}${available.length > 5 ? ", …" : ""}). Use an ACP wire id such as default[].`,
  );
}

export function isAcpSessionModeId(value: unknown): value is AcpSessionModeId {
  return value === "agent" || value === "plan" || value === "ask";
}

/** Parse `models.availableModels` from session/new or session/load results. */
export function parseAcpAvailableModels(sessionResult: unknown): AcpAvailableModel[] {
  if (!sessionResult || typeof sessionResult !== "object") return [];
  const models = (sessionResult as { models?: unknown }).models;
  if (!models || typeof models !== "object") return [];
  const available = (models as { availableModels?: unknown }).availableModels;
  if (!Array.isArray(available)) return [];
  const out: AcpAvailableModel[] = [];
  for (const entry of available) {
    if (!entry || typeof entry !== "object") continue;
    const modelId = (entry as { modelId?: unknown }).modelId;
    if (typeof modelId !== "string" || !modelId.trim()) continue;
    const name = (entry as { name?: unknown }).name;
    out.push({
      modelId: modelId.trim(),
      ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}),
    });
  }
  return out;
}
