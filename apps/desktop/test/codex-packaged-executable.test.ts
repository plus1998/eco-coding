import { expect, test } from "bun:test";
import path from "node:path";
import {
  resolvePackagedClaudeExecutableCandidate,
  resolvePackagedCodexExecutableCandidate,
} from "../src/main/packaged-runtime-executables";

test("resolves the bundled macOS arm64 Codex executable outside app.asar", () => {
  expect(
    resolvePackagedCodexExecutableCandidate({
      resourcesPath: "/Applications/Eco Coding.app/Contents/Resources",
      platform: "darwin",
      arch: "arm64",
    }),
  ).toBe(
    path.join(
      "/Applications/Eco Coding.app/Contents/Resources",
      "app.asar.unpacked/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex",
    ),
  );
});

test("resolves the bundled Windows x64 Codex executable", () => {
  expect(
    resolvePackagedCodexExecutableCandidate({
      resourcesPath: "C:\\Program Files\\Eco Coding\\resources",
      platform: "win32",
      arch: "x64",
    }),
  ).toEndWith(
    "app.asar.unpacked/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
  );
});

test("returns undefined for unsupported packaged targets", () => {
  expect(
    resolvePackagedCodexExecutableCandidate({
      resourcesPath: "/resources",
      platform: "freebsd",
      arch: "x64",
    }),
  ).toBeUndefined();
});

test("resolves the bundled macOS arm64 Claude executable outside app.asar", () => {
  expect(
    resolvePackagedClaudeExecutableCandidate({
      resourcesPath: "/Applications/Eco Coding.app/Contents/Resources",
      platform: "darwin",
      arch: "arm64",
    }),
  ).toBe(
    path.join(
      "/Applications/Eco Coding.app/Contents/Resources",
      "app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude",
    ),
  );
});

test("resolves the bundled Windows x64 Claude executable", () => {
  expect(
    resolvePackagedClaudeExecutableCandidate({
      resourcesPath: "C:\\Program Files\\Eco Coding\\resources",
      platform: "win32",
      arch: "x64",
    }),
  ).toEndWith(
    "app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe",
  );
});
