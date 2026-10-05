import type { PackageScriptOverrides } from "../shared/ipc";

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

/** localStorage only ever held trailing args; prefixes were never stored client-side. */
async function migrateLegacyWorkspaceArgs(workspacePath: string): Promise<PackageScriptOverrides> {
  const legacy = readLegacyStore()[workspacePath];
  if (!legacy || Object.keys(legacy).length === 0 || !window.eco?.savePackageScriptArgs) {
    return { args: {}, prefixes: {} };
  }
  let merged: PackageScriptOverrides = { args: {}, prefixes: {} };
  for (const [scriptName, args] of Object.entries(legacy)) {
    const result = await window.eco.savePackageScriptArgs({
      workspacePath,
      script: scriptName,
      args,
    });
    merged = { args: result.scriptArgs, prefixes: result.scriptPrefixes };
  }
  clearLegacyWorkspaceArgs(workspacePath);
  return merged;
}

export async function readWorkspaceScriptOverrides(workspacePath: string): Promise<PackageScriptOverrides> {
  if (!window.eco?.listPackageScripts) {
    return { args: { ...(readLegacyStore()[workspacePath] ?? {}) }, prefixes: {} };
  }
  const listing = await window.eco.listPackageScripts(workspacePath);
  const args = listing.scriptArgs ?? {};
  const prefixes = listing.scriptPrefixes ?? {};
  if (Object.keys(args).length > 0 || Object.keys(prefixes).length > 0) {
    clearLegacyWorkspaceArgs(workspacePath);
    return { args: { ...args }, prefixes: { ...prefixes } };
  }
  return migrateLegacyWorkspaceArgs(workspacePath);
}

export async function saveScriptOverrides(
  workspacePath: string,
  scriptName: string,
  patch: { args?: string; prefix?: string },
): Promise<PackageScriptOverrides> {
  if (!window.eco?.savePackageScriptArgs) {
    throw new Error("Desktop API unavailable.");
  }
  const result = await window.eco.savePackageScriptArgs({
    workspacePath,
    script: scriptName,
    ...(patch.args !== undefined ? { args: patch.args } : {}),
    ...(patch.prefix !== undefined ? { prefix: patch.prefix } : {}),
  });
  clearLegacyWorkspaceArgs(workspacePath);
  return { args: { ...result.scriptArgs }, prefixes: { ...result.scriptPrefixes } };
}
