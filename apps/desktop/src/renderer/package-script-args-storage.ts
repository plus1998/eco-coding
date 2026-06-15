const STORAGE_KEY = "eco.package-script-args";

export type PackageScriptArgsByWorkspace = Record<string, Record<string, string>>;

function readStore(): PackageScriptArgsByWorkspace {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
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
          scriptArgs[scriptName] = args;
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

function writeStore(store: PackageScriptArgsByWorkspace): void {
  if (typeof window === "undefined") {
    return;
  }
  const normalized: PackageScriptArgsByWorkspace = {};
  for (const [workspacePath, scripts] of Object.entries(store)) {
    const scriptArgs: Record<string, string> = {};
    for (const [scriptName, args] of Object.entries(scripts)) {
      const trimmed = args.trim();
      if (trimmed) {
        scriptArgs[scriptName] = trimmed;
      }
    }
    if (Object.keys(scriptArgs).length > 0) {
      normalized[workspacePath] = scriptArgs;
    }
  }
  if (Object.keys(normalized).length === 0) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

export function readWorkspaceScriptArgs(workspacePath: string): Record<string, string> {
  return { ...readStore()[workspacePath] };
}

export function readScriptArgs(workspacePath: string, scriptName: string): string {
  return readStore()[workspacePath]?.[scriptName] ?? "";
}

export function saveScriptArgs(workspacePath: string, scriptName: string, args: string): Record<string, string> {
  const store = readStore();
  const workspaceArgs = { ...store[workspacePath] };
  const trimmed = args.trim();
  if (trimmed) {
    workspaceArgs[scriptName] = trimmed;
  } else {
    delete workspaceArgs[scriptName];
  }
  if (Object.keys(workspaceArgs).length > 0) {
    store[workspacePath] = workspaceArgs;
  } else {
    delete store[workspacePath];
  }
  writeStore(store);
  return workspaceArgs;
}
