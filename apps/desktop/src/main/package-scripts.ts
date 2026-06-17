import fs from "node:fs/promises";
import path from "node:path";
import type {
  PackageManagerKind,
  PackageScriptInfo,
  PackageScriptsListResult,
  RunPackageScriptRequest,
} from "../shared/ipc";
import { buildRunCommand } from "../shared/package-script-run";
import { detectPackageManager } from "./workspace-inspect";

export { buildRunCommand } from "../shared/package-script-run";

const PACKAGE_MANAGER_FIELD_RE = /^(npm|pnpm|yarn|bun)(?:(?:@|:)[\w.+-]*)?$/;

export function parsePackageManagerField(value: unknown): PackageManagerKind | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  const match = PACKAGE_MANAGER_FIELD_RE.exec(normalized);
  if (!match?.[1]) {
    return undefined;
  }
  return match[1] as PackageManagerKind;
}

export async function resolvePackageManager(
  workspacePath: string,
  packageJson?: Record<string, unknown>,
): Promise<PackageManagerKind> {
  const fromLockfile = await detectPackageManager(workspacePath);
  if (fromLockfile) {
    return fromLockfile;
  }
  const fromField = parsePackageManagerField(packageJson?.packageManager);
  if (fromField) {
    return fromField;
  }
  return "npm";
}

function parseScriptsField(scripts: unknown): PackageScriptInfo[] {
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    return [];
  }
  const entries: PackageScriptInfo[] = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command === "string" && command.trim()) {
      entries.push({ name, command });
    }
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

export async function readPackageJson(workspacePath: string): Promise<Record<string, unknown> | undefined> {
  const packageJsonPath = path.join(path.resolve(workspacePath), "package.json");
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export async function listPackageScripts(workspacePath: string): Promise<PackageScriptsListResult> {
  const resolvedPath = path.resolve(workspacePath);
  const packageJson = await readPackageJson(resolvedPath);
  const packageManager = await resolvePackageManager(resolvedPath, packageJson);
  const scripts = parseScriptsField(packageJson?.scripts);
  const packageName = typeof packageJson?.name === "string" ? packageJson.name : undefined;

  return {
    workspacePath: resolvedPath,
    hasPackageJson: Boolean(packageJson),
    ...(packageName && { packageName }),
    packageManager,
    scripts,
  };
}

export async function preparePackageScriptRun(
  request: RunPackageScriptRequest,
): Promise<{ workspacePath: string; script: string; command: string[] }> {
  const resolvedPath = path.resolve(request.workspacePath);
  const listing = await listPackageScripts(resolvedPath);
  const scriptName = request.script.trim();
  const knownScript = listing.scripts.find((entry) => entry.name === scriptName);
  if (!knownScript) {
    throw new Error(`Unknown script: ${scriptName}`);
  }

  const command = buildRunCommand(listing.packageManager, scriptName, request.args);
  return {
    workspacePath: resolvedPath,
    script: scriptName,
    command,
  };
}
