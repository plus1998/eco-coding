import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  probeCliVersionExecutable,
  readCliVersionOutput,
  resolvePackagedCodexExecutableCandidate,
} from "../src/main/packaged-runtime-executables";

const sourceCodexExe = path.join(
  import.meta.dir,
  "../node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
);

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function copyCodexIntoSpacedResources(): string {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "eco-codex-probe-"));
  tempDirs.push(tempRoot);
  const resourcesPath = path.join(tempRoot, "Eco Coding", "resources");
  const executable = resolvePackagedCodexExecutableCandidate({
    resourcesPath,
    platform: "win32",
    arch: "x64",
  });
  if (!executable) {
    throw new Error("Expected a packaged Windows Codex executable candidate.");
  }
  mkdirSync(path.dirname(executable), { recursive: true });
  cpSync(sourceCodexExe, executable, { force: true });
  return executable;
}

test("probes Codex CLI from a Windows install path containing spaces", () => {
  if (process.platform !== "win32") {
    return;
  }
  if (!Bun.file(sourceCodexExe).size) {
    throw new Error(`Missing Codex fixture binary: ${sourceCodexExe}`);
  }

  const executable = copyCodexIntoSpacedResources();
  expect(probeCliVersionExecutable(executable)).toBe(true);
  expect(readCliVersionOutput(executable)).toMatch(/^codex-cli /);
});
