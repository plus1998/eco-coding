import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  CODEX_PLATFORM_PACKAGES,
  codexPlatformBaseVersion,
  parseCodexAppServerUserAgentVersion,
  parseCodexCliVersion,
  readCodexDependencyPins,
} from "../src/codex-version";

/** Repo root from `packages/runtime/test`. */
const repoRoot = path.resolve(import.meta.dir, "../../..");
const appPackageJsonPath = path.join(repoRoot, "apps/desktop/package.json");

function readAppManifest(): unknown {
  return JSON.parse(fs.readFileSync(appPackageJsonPath, "utf8"));
}

test("parseCodexCliVersion reads the real binary's version banner", () => {
  expect(parseCodexCliVersion("codex-cli 0.160.1\n")).toBe("0.160.1");
  expect(parseCodexCliVersion("codex-cli 0.160.1")).toBe("0.160.1");
  expect(parseCodexCliVersion("warning: something\ncodex-cli 1.2.3-rc.1")).toBe("1.2.3-rc.1");
  expect(parseCodexCliVersion("codex 0.160.1")).toBeUndefined();
  expect(parseCodexCliVersion("")).toBeUndefined();
});

test("parseCodexAppServerUserAgentVersion reads the server version from the handshake", () => {
  // Real 0.160.1 app-server handshake, captured from the pinned binary.
  expect(
    parseCodexAppServerUserAgentVersion(
      "eco_coding/0.160.1 (Mac OS 27.0.1; arm64) unknown (eco_coding; 0.0.1)",
    ),
  ).toBe("0.160.1");
  expect(parseCodexAppServerUserAgentVersion("codex_cli_rs/0.160.1 (Mac OS 15; arm64) unknown")).toBe(
    "0.160.1",
  );
  // The trailing `(clientName; clientVersion)` must never be mistaken for the server.
  expect(parseCodexAppServerUserAgentVersion("eco_coding/0.160.1 (Linux; x64)")).toBe("0.160.1");
  expect(
    parseCodexAppServerUserAgentVersion(
      "Codex Desktop/0.160.1 (Mac OS 27.0.1; arm64) dumb (eco_coding; 0.0.1)",
    ),
  ).toBe("0.160.1");
  expect(parseCodexAppServerUserAgentVersion("Codex Desktop/ (eco_coding; 0.160.1)")).toBeUndefined();
  expect(parseCodexAppServerUserAgentVersion("eco_coding")).toBeUndefined();
  expect(parseCodexAppServerUserAgentVersion("/0.160.1")).toBeUndefined();
  expect(parseCodexAppServerUserAgentVersion("eco_coding/")).toBeUndefined();
  expect(parseCodexAppServerUserAgentVersion("")).toBeUndefined();
});

test("the app pins every Codex platform package to the main dependency version", () => {
  const pins = readCodexDependencyPins(readAppManifest());
  expect(pins.version).toMatch(/^\d+\.\d+\.\d+/);
  expect(Object.keys(pins.platformVersions).sort()).toEqual([...CODEX_PLATFORM_PACKAGES].sort());
  for (const [packageName, platformVersion] of Object.entries(pins.platformVersions)) {
    expect(`${packageName}=${codexPlatformBaseVersion(packageName, platformVersion)}`).toBe(
      `${packageName}=${pins.version}`,
    );
  }
});

test("the installed Codex binary reports the pinned dependency version", () => {
  const pins = readCodexDependencyPins(readAppManifest());
  const executable = path.join(repoRoot, "apps/desktop/node_modules/.bin/codex");
  if (!fs.existsSync(executable)) {
    // A checkout without the app's dependencies installed cannot check the binary.
    return;
  }
  const output = execFileSync(executable, ["--version"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(parseCodexCliVersion(output)).toBe(pins.version);
});
