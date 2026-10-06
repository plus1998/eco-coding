import type { PackageManagerKind } from "./ipc";

/**
 * Build the package-manager argv for a script run.
 *
 * `args` are trailing arguments appended after `<pm> run <script>`.
 * Leading commands (nvm switch, env exports) are NOT part of argv — see
 * `joinPrefixedCommand` / main `buildPrefixedShellLine`.
 */
export function buildRunCommand(packageManager: PackageManagerKind, script: string, args?: string): string[] {
  const trimmedArgs = args?.trim();
  const tokens = trimmedArgs ? splitShellArgs(trimmedArgs) : [];
  switch (packageManager) {
    case "bun":
      return tokens.length > 0 ? ["bun", "run", script, ...tokens] : ["bun", "run", script];
    case "pnpm":
      return tokens.length > 0
        ? tokens[0] === "--"
          ? ["pnpm", "run", script, ...tokens]
          : ["pnpm", "run", script, "--", ...tokens]
        : ["pnpm", "run", script];
    case "yarn":
      return tokens.length > 0
        ? tokens[0] === "--"
          ? ["yarn", "run", script, ...tokens]
          : ["yarn", "run", script, "--", ...tokens]
        : ["yarn", "run", script];
    default:
      return tokens.length > 0
        ? tokens[0] === "--"
          ? ["npm", "run", script, ...tokens]
          : ["npm", "run", script, "--", ...tokens]
        : ["npm", "run", script];
  }
}

/** Join a leading shell command and the package-manager argv for display / clipboard. */
export function joinPrefixedCommand(prefix: string | undefined, command: readonly string[]): string {
  const normalizedPrefix = normalizeCommandPrefix(prefix);
  const body = command.join(" ");
  return normalizedPrefix ? `${normalizedPrefix} && ${body}` : body;
}

/**
 * Leading command as authored by the user (shell fragment, not escaped).
 * A trailing connector (`nvm use 20 &&`) is dropped — we always insert `&&`.
 */
export function normalizeCommandPrefix(prefix: string | undefined): string {
  return (prefix ?? "")
    .trim()
    .replace(/(?:&&|\|\||[;&])\s*$/, "")
    .trim();
}

export function formatRunCommand(
  packageManager: PackageManagerKind,
  script: string,
  args?: string,
  prefix?: string,
): string {
  return joinPrefixedCommand(prefix, buildRunCommand(packageManager, script, args));
}

function splitShellArgs(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}
