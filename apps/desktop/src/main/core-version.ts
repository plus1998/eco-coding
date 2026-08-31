import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCodexExecutable } from "./codex-runtime-run";
import { readCliVersionOutput } from "./packaged-runtime-executables";
import { resolveCursorAgentExecutable } from "@eco/runtime";
const requireFromHere = createRequire(import.meta.url);

function readPackageJsonVersion(pkgPath: string, expectedName?: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string; version?: string };
    if (expectedName && pkg.name !== expectedName) return undefined;
    return pkg.version?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve an npm package version via Node module resolution, then fall back to
 * `apps/desktop/node_modules/<name>/package.json` (same `../..` root as other main helpers).
 * Do not use `../../..` — from `src/main` or bundled `dist/main` that lands on `apps/`, not desktop.
 */
function readLocalNpmPackageVersion(packageName: string): string | undefined {
  try {
    const entry = requireFromHere.resolve(packageName);
    let dir = path.dirname(entry);
    for (let i = 0; i < 8; i += 1) {
      const version = readPackageJsonVersion(path.join(dir, "package.json"), packageName);
      if (version) return version;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // fall through to relative node_modules
  }

  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  return readPackageJsonVersion(
    path.join(appRoot, "node_modules", ...packageName.split("/"), "package.json"),
    packageName,
  );
}

export function getCodexVersion(): string | undefined {
  const executable = resolveCodexExecutable();
  if (!executable) return undefined;
  return readCliVersionOutput(executable);
}

export function getClaudeVersion(): string | undefined {
  return readLocalNpmPackageVersion("@anthropic-ai/claude-agent-sdk");
}

export function getCursorVersion(): string | undefined {
  try {
    const executable = resolveCursorAgentExecutable();
    return readCliVersionOutput(executable);
  } catch {
    return undefined;
  }
}
