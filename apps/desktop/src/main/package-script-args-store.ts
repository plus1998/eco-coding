import fs from "node:fs/promises";
import path from "node:path";
import type { PackageScriptOverrides } from "../shared/ipc";

export type PackageScriptArgsByWorkspace = Record<string, Record<string, string>>;

/** Whole-store snapshot: per-workspace maps of script name → args / prefix. */
export interface PackageScriptOverridesSnapshot {
  args: PackageScriptArgsByWorkspace;
  prefixes: PackageScriptArgsByWorkspace;
}

/** v2 envelope version; v1 (no envelope) is a flat args-by-workspace map. */
const STORE_VERSION = 2;

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

export function normalizePackageScriptOverrides(value: unknown): PackageScriptOverridesSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { args: {}, prefixes: {} };
  }
  const record = value as Record<string, unknown>;
  return {
    args: normalizePackageScriptArgsStore(record.args),
    prefixes: normalizePackageScriptArgsStore(record.prefixes),
  };
}

/** Drop workspaces that carry neither args nor prefixes. */
function pruneOverrides(overrides: PackageScriptOverridesSnapshot): PackageScriptOverridesSnapshot {
  const args: PackageScriptArgsByWorkspace = {};
  const prefixes: PackageScriptArgsByWorkspace = {};
  for (const [workspacePath, scriptArgs] of Object.entries(overrides.args)) {
    if (Object.keys(scriptArgs).length > 0) {
      args[workspacePath] = scriptArgs;
    }
  }
  for (const [workspacePath, scriptPrefixes] of Object.entries(overrides.prefixes)) {
    if (Object.keys(scriptPrefixes).length > 0) {
      prefixes[workspacePath] = scriptPrefixes;
    }
  }
  return { args, prefixes };
}

function isEmptyOverrides(overrides: PackageScriptOverridesSnapshot): boolean {
  return Object.keys(overrides.args).length === 0 && Object.keys(overrides.prefixes).length === 0;
}

export class PackageScriptArgsStore {
  private cache: PackageScriptOverridesSnapshot | undefined;

  constructor(private readonly filePath: string) {}

  private async load(): Promise<PackageScriptOverridesSnapshot> {
    if (this.cache) {
      return this.cache;
    }
    this.cache = await this.readFromDisk();
    return this.cache;
  }

  /** v2 envelope `{ version, args, prefixes }`; legacy files are a flat args map. */
  private async readFromDisk(): Promise<PackageScriptOverridesSnapshot> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "version" in parsed) {
        return normalizePackageScriptOverrides(parsed);
      }
      return { args: normalizePackageScriptArgsStore(parsed), prefixes: {} };
    } catch {
      return { args: {}, prefixes: {} };
    }
  }

  private async persist(overrides: PackageScriptOverridesSnapshot): Promise<void> {
    const pruned = pruneOverrides(overrides);
    this.cache = pruned;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    if (isEmptyOverrides(pruned)) {
      try {
        await fs.unlink(this.filePath);
      } catch {
        // Missing file is fine.
      }
      return;
    }
    const envelope = { version: STORE_VERSION, args: pruned.args, prefixes: pruned.prefixes };
    await fs.writeFile(this.filePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  }

  private async workspaceOverrides(workspacePath: string): Promise<PackageScriptOverrides> {
    const resolved = path.resolve(workspacePath);
    const store = await this.load();
    return {
      args: { ...(store.args[resolved] ?? store.args[workspacePath] ?? {}) },
      prefixes: { ...(store.prefixes[resolved] ?? store.prefixes[workspacePath] ?? {}) },
    };
  }

  async getWorkspaceOverrides(workspacePath: string): Promise<PackageScriptOverrides> {
    return this.workspaceOverrides(workspacePath);
  }

  /** Returns cached snapshot; call `warmCache()` during app init before sync reads. */
  getAllSnapshotSync(): PackageScriptOverridesSnapshot {
    if (!this.cache) {
      return { args: {}, prefixes: {} };
    }
    return {
      args: { ...this.cache.args },
      prefixes: { ...this.cache.prefixes },
    };
  }

  async warmCache(): Promise<void> {
    await this.load();
  }

  async replaceAll(overrides: unknown): Promise<void> {
    await this.persist(normalizePackageScriptOverrides(overrides));
  }

  /**
   * Write one script's overrides. Omitted fields keep their stored value;
   * blank values clear the stored entry.
   */
  async saveScriptOverrides(
    workspacePath: string,
    scriptName: string,
    patch: { args?: string; prefix?: string },
  ): Promise<PackageScriptOverrides> {
    const resolved = path.resolve(workspacePath);
    const trimmedName = scriptName.trim();
    if (!trimmedName) {
      throw new Error("Script name is required.");
    }
    const store = await this.load();
    const argsByWorkspace = { ...store.args };
    const prefixesByWorkspace = { ...store.prefixes };

    const nextArgs = { ...(argsByWorkspace[resolved] ?? {}) };
    const nextPrefixes = { ...(prefixesByWorkspace[resolved] ?? {}) };

    if (patch.args !== undefined) {
      const trimmed = patch.args.trim();
      if (trimmed) {
        nextArgs[trimmedName] = trimmed;
      } else {
        delete nextArgs[trimmedName];
      }
    }
    if (patch.prefix !== undefined) {
      const trimmed = patch.prefix.trim();
      if (trimmed) {
        nextPrefixes[trimmedName] = trimmed;
      } else {
        delete nextPrefixes[trimmedName];
      }
    }

    if (Object.keys(nextArgs).length > 0) {
      argsByWorkspace[resolved] = nextArgs;
    } else {
      delete argsByWorkspace[resolved];
    }
    if (Object.keys(nextPrefixes).length > 0) {
      prefixesByWorkspace[resolved] = nextPrefixes;
    } else {
      delete prefixesByWorkspace[resolved];
    }

    // Drop legacy non-resolved key if present.
    if (workspacePath !== resolved) {
      delete argsByWorkspace[workspacePath];
      delete prefixesByWorkspace[workspacePath];
    }

    await this.persist({ args: argsByWorkspace, prefixes: prefixesByWorkspace });
    return { args: nextArgs, prefixes: nextPrefixes };
  }
}

export function createPackageScriptArgsStore(filePath: string): PackageScriptArgsStore {
  return new PackageScriptArgsStore(filePath);
}
