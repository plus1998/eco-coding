import type { PackageManagerKind } from "./ipc";

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

export function formatRunCommand(packageManager: PackageManagerKind, script: string, args?: string): string {
  return buildRunCommand(packageManager, script, args).join(" ");
}

function splitShellArgs(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}
