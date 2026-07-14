import fs from "node:fs/promises";
import path from "node:path";

export type PackageScriptArgsByWorkspace = Record<string, Record<string, string>>;

function normalizeArgsMap(scripts: unknown): Record<string, string> {
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    return {};
  }
  const scriptArgs: Record<string, string> = {};
  for (const [scriptName, args] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof args === "string" && args.trim()) {
      scriptArgs[scriptName] = args.trim();
    }
  }
  return scriptArgs;
}

export function normalizePackageScriptArgsStore(value: unknown): PackageScriptArgsByWorkspace {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const store: PackageScriptArgsByWorkspace = {};
  for (const [workspacePath, scripts] of Object.entries(value as Record<string, unknown>)) {
    if (typeof workspacePath !== "string" || !workspacePath.trim()) {
      continue;
    }
    const scriptArgs = normalizeArgsMap(scripts);
    if (Object.keys(scriptArgs).length > 0) {
      store[workspacePath] = scriptArgs;
    }
  }
  return store;
}

export class PackageScriptArgsStore {
  private cache: PackageScriptArgsByWorkspace | undefined;

  constructor(private readonly filePath: string) {}

  private async load(): Promise<PackageScriptArgsByWorkspace> {
    if (this.cache) {
      return this.cache;
    }
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.cache = normalizePackageScriptArgsStore(JSON.parse(raw) as unknown);
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private async persist(store: PackageScriptArgsByWorkspace): Promise<void> {
    this.cache = store;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    if (Object.keys(store).length === 0) {
      try {
        await fs.unlink(this.filePath);
      } catch {
        // Missing file is fine.
      }
      return;
    }
    await fs.writeFile(this.filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }

  async getWorkspaceArgs(workspacePath: string): Promise<Record<string, string>> {
    const resolved = path.resolve(workspacePath);
    const store = await this.load();
    return { ...(store[resolved] ?? store[workspacePath] ?? {}) };
  }

  async saveScriptArgs(
    workspacePath: string,
    scriptName: string,
    args: string,
  ): Promise<Record<string, string>> {
    const resolved = path.resolve(workspacePath);
    const trimmedName = scriptName.trim();
    if (!trimmedName) {
      throw new Error("Script name is required.");
    }
    const store = { ...(await this.load()) };
    const workspaceArgs = { ...(store[resolved] ?? {}) };
    const trimmedArgs = args.trim();
    if (trimmedArgs) {
      workspaceArgs[trimmedName] = trimmedArgs;
    } else {
      delete workspaceArgs[trimmedName];
    }
    if (Object.keys(workspaceArgs).length > 0) {
      store[resolved] = workspaceArgs;
    } else {
      delete store[resolved];
    }
    // Drop legacy non-resolved key if present.
    if (workspacePath !== resolved) {
      delete store[workspacePath];
    }
    await this.persist(normalizePackageScriptArgsStore(store));
    return { ...workspaceArgs };
  }
}

export function createPackageScriptArgsStore(filePath: string): PackageScriptArgsStore {
  return new PackageScriptArgsStore(filePath);
}
