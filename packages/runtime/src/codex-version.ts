import { execFileSync } from "node:child_process";

/**
 * Pinned Codex versions, read from the installing app's manifest.
 *
 * The app-server handshake reports whatever the running binary was built from,
 * so a hardcoded expected string silently rots after every upgrade. Read the
 * pin from `package.json` instead and compare it against the real binary.
 */

/** Native packages an install must pin alongside `@openai/codex`. */
export const CODEX_PLATFORM_PACKAGES = [
  "@openai/codex-darwin-arm64",
  "@openai/codex-darwin-x64",
  "@openai/codex-linux-arm64",
  "@openai/codex-linux-x64",
  "@openai/codex-win32-arm64",
  "@openai/codex-win32-x64",
] as const;

export type CodexPlatformPackage = (typeof CODEX_PLATFORM_PACKAGES)[number];

export interface CodexDependencyPins {
  /** `dependencies["@openai/codex"]`, without any `npm:` alias prefix. */
  version: string;
  /**
   * `optionalDependencies` platform packages mapped to the raw alias target,
   * e.g. `0.160.1-darwin-arm64`. A missing platform package is absent from the map.
   */
  platformVersions: Record<string, string>;
}

/**
 * Read `@openai/codex` pins from a parsed `package.json`.
 * Throws when the dependency is missing or not a plain semver-ish version.
 */
export function readCodexDependencyPins(packageJson: unknown): CodexDependencyPins {
  const manifest = asRecord(packageJson);
  const dependencies = asRecord(manifest?.dependencies);
  const optionalDependencies = asRecord(manifest?.optionalDependencies);
  const version = readPinnedVersion(dependencies?.["@openai/codex"]);
  if (!version) {
    throw new Error('package.json does not pin dependencies["@openai/codex"].');
  }

  const platformVersions: Record<string, string> = {};
  for (const packageName of CODEX_PLATFORM_PACKAGES) {
    const pinned = readPinnedVersion(optionalDependencies?.[packageName]);
    if (pinned) {
      platformVersions[packageName] = pinned;
    }
  }
  return { version, platformVersions };
}

/**
 * Strip the platform suffix a native package pin carries:
 * `("@openai/codex-darwin-arm64", "0.160.1-darwin-arm64")` → `"0.160.1"`.
 * Returns the input unchanged when the suffix does not match.
 */
export function codexPlatformBaseVersion(packageName: string, platformVersion: string): string {
  const suffix = packageName.replace(/^@openai\/codex-/, "");
  const trimmed = `-${suffix}`;
  return suffix && platformVersion.endsWith(trimmed)
    ? platformVersion.slice(0, -trimmed.length)
    : platformVersion;
}

/** `codex-cli 0.160.1` → `0.160.1`. Returns undefined for other output shapes. */
export function parseCodexCliVersion(output: string): string | undefined {
  const match = output.match(/\bcodex-cli\s+(\S+)/);
  return match?.[1];
}

/**
 * Read the app-server's own version out of the `initialize` user agent.
 *
 * Codex 0.160 stopped echoing a `codex-cli <version>` banner and now sends
 * `<clientName>/<serverVersion> (<os>; <arch>) <lib> (<clientName>; <clientVersion>)`,
 * e.g. `eco_coding/0.160.1 (Mac OS 27.0.1; arm64) unknown (eco_coding; 0.0.1)`.
 * The server version is the token after the first slash, so callers can compare
 * the running server against the binary's `--version` instead of a hardcoded string.
 */
export function parseCodexAppServerUserAgentVersion(userAgent: string): string | undefined {
  // The originator can contain spaces (e.g. "Codex Desktop"). Only the version
  // following the prefix's slash is authoritative; never read the trailing client version.
  return /^[^/()]+\/(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)(?=\s|$)/.exec(userAgent.trim())?.[1];
}

/**
 * Run a Codex executable with `--version` and return the version it reports.
 * Returns undefined when the binary is missing or unreadable.
 */
export function readCodexCliVersion(executable: string, timeoutMs = 30_000): string | undefined {
  try {
    const output = execFileSync(executable, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: timeoutMs,
    });
    return parseCodexCliVersion(output);
  } catch {
    return undefined;
  }
}

function readPinnedVersion(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  // Platform packages use `npm:@openai/codex@<version>-<platform>` aliases.
  const alias = trimmed.lastIndexOf("@");
  const candidate = alias > 0 ? trimmed.slice(alias + 1) : trimmed;
  return candidate || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
