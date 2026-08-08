import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildAgentBrowserMcpArgs,
  ensureNativeBinaryExecutable,
  resolveAgentBrowserBinary,
} from "../src/main/agent-browser-resolve";

test("buildAgentBrowserMcpArgs puts --cdp and --session before mcp subcommand", () => {
  expect(buildAgentBrowserMcpArgs(9456, "thr_abc")).toEqual([
    "--cdp",
    "9456",
    "--session",
    "thr_abc",
    "--idle-timeout",
    "0",
    "mcp",
    "--tools",
    "core",
  ]);
  expect(buildAgentBrowserMcpArgs(9456)).toEqual([
    "--cdp",
    "9456",
    "--idle-timeout",
    "0",
    "mcp",
    "--tools",
    "core",
  ]);
});

test("ensureNativeBinaryExecutable chmods unix binary without +x", () => {
  if (process.platform === "win32") {
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eco-ab-bin-"));
  const file = path.join(dir, "fake-bin");
  try {
    fs.writeFileSync(file, "#!/bin/sh\necho ok\n", { mode: 0o644 });
    expect((fs.statSync(file).mode & 0o111) === 0).toBe(true);
    expect(ensureNativeBinaryExecutable(file)).toBe(true);
    expect((fs.statSync(file).mode & 0o111) !== 0).toBe(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveAgentBrowserBinary finds platform binary in monorepo", () => {
  const resolved = resolveAgentBrowserBinary();
  // May fail on unsupported arch; when available path must be executable.
  if (resolved.available) {
    expect(resolved.binaryPath).toBeTruthy();
    expect(ensureNativeBinaryExecutable(resolved.binaryPath!)).toBe(true);
  }
});
