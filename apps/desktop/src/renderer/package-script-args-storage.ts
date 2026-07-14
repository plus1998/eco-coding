const LEGACY_STORAGE_KEY = "eco.package-script-args";

export type PackageScriptArgsByWorkspace = Record<string, Record<string, string>>;

function readLegacyStore(): PackageScriptArgsByWorkspace {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const store: PackageScriptArgsByWorkspace = {};
    for (const [workspacePath, scripts] of Object.entries(parsed as Record<string, unknown>)) {
      if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
        continue;
      }
      const scriptArgs: Record<string, string> = {};
      for (const [scriptName, args] of Object.entries(scripts as Record<string, unknown>)) {
        if (typeof args === "string" && args.trim()) {
          scriptArgs[scriptName] = args.trim();
        }
      }
      if (Object.keys(scriptArgs).length > 0) {
        store[workspacePath] = scriptArgs;
      }
    }
    return store;
  } catch {
    return {};
  }
}

function clearLegacyWorkspaceArgs(workspacePath: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const store = readLegacyStore();
  if (!(workspacePath in store)) {
    return;
  }
  delete store[workspacePath];
  if (Object.keys(store).length === 0) {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(store));
}

async function migrateLegacyWorkspaceArgs(workspacePath: string): Promise<Record<string, string>> {
  const legacy = readLegacyStore()[workspacePath];
  if (!legacy || Object.keys(legacy).length === 0 || !window.eco?.savePackageScriptArgs) {
    return {};
  }
  let merged: Record<string, string> = {};
  for (const [scriptName, args] of Object.entries(legacy)) {
    const result = await window.eco.savePackageScriptArgs({
      workspacePath,
      script: scriptName,
      args,
    });
    merged = result.scriptArgs;
  }
  clearLegacyWorkspaceArgs(workspacePath);
  return merged;
}

export async function readWorkspaceScriptArgs(workspacePath: string): Promise<Record<string, string>> {
  if (!window.eco?.listPackageScripts) {
    return { ...(readLegacyStore()[workspacePath] ?? {}) };
  }
  const listing = await window.eco.listPackageScripts(workspacePath);
  const fromMain = listing.scriptArgs ?? {};
  if (Object.keys(fromMain).length > 0) {
    clearLegacyWorkspaceArgs(workspacePath);
    return { ...fromMain };
  }
  return migrateLegacyWorkspaceArgs(workspacePath);
}

export async function saveScriptArgs(
  workspacePath: string,
  scriptName: string,
  args: string,
): Promise<Record<string, string>> {
  if (!window.eco?.savePackageScriptArgs) {
    throw new Error("Desktop API unavailable.");
  }
  const result = await window.eco.savePackageScriptArgs({
    workspacePath,
    script: scriptName,
    args,
  });
  clearLegacyWorkspaceArgs(workspacePath);
  return { ...result.scriptArgs };
}
