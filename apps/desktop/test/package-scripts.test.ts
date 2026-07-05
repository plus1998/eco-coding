import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BackgroundTerminalTaskRegistry } from "../src/main/background-terminal-tasks";
import type { InteractiveTerminalManager } from "../src/main/interactive-terminal-manager";
import {
  listPackageScripts,
  parsePackageManagerField,
  preparePackageScriptRun,
  readPackageJson,
  resolvePackageManager,
  runPreparedPackageScriptAsBackgroundTask,
  runPreparedPackageScriptInTerminal,
} from "../src/main/package-scripts";
import { buildRunCommand, formatRunCommand } from "../src/shared/package-script-run";

let tempDir = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-package-scripts-"));
});

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  }
});

test("parsePackageManagerField accepts npm field variants", () => {
  expect(parsePackageManagerField("npm@10.0.0")).toBe("npm");
  expect(parsePackageManagerField("pnpm@9.0.0")).toBe("pnpm");
  expect(parsePackageManagerField("yarn")).toBe("yarn");
  expect(parsePackageManagerField("bun")).toBe("bun");
  expect(parsePackageManagerField("invalid")).toBeUndefined();
});

test("listPackageScripts returns sorted scripts from package.json", async () => {
  await fs.writeFile(
    path.join(tempDir, "package.json"),
    JSON.stringify({
      name: "demo-app",
      scripts: {
        build: "tsc -b",
        dev: "vite",
        test: "vitest run",
      },
    }),
    "utf8",
  );

  const result = await listPackageScripts(tempDir);
  expect(result.hasPackageJson).toBe(true);
  expect(result.packageName).toBe("demo-app");
  expect(result.scripts.map((entry) => entry.name)).toEqual(["build", "dev", "test"]);
  expect(result.scripts[0]?.command).toBe("tsc -b");
});

test("listPackageScripts returns empty scripts when package.json is missing", async () => {
  const result = await listPackageScripts(tempDir);
  expect(result.hasPackageJson).toBe(false);
  expect(result.scripts).toEqual([]);
  expect(result.packageManager).toBe("npm");
});

test("listPackageScripts returns empty scripts when package.json has no scripts", async () => {
  await fs.writeFile(path.join(tempDir, "package.json"), JSON.stringify({ name: "empty-app" }), "utf8");

  const result = await listPackageScripts(tempDir);
  expect(result.hasPackageJson).toBe(true);
  expect(result.scripts).toEqual([]);
});

test("resolvePackageManager prefers lockfile over packageManager field", async () => {
  await fs.writeFile(
    path.join(tempDir, "package.json"),
    JSON.stringify({ packageManager: "pnpm@9.0.0" }),
    "utf8",
  );
  await fs.writeFile(path.join(tempDir, "bun.lock"), "", "utf8");

  const packageJson = await readPackageJson(tempDir);
  const resolved = await resolvePackageManager(tempDir, packageJson);
  expect(resolved).toBe("bun");
});

test("resolvePackageManager falls back to packageManager field", async () => {
  await fs.writeFile(
    path.join(tempDir, "package.json"),
    JSON.stringify({ packageManager: "pnpm@9.0.0" }),
    "utf8",
  );

  const packageJson = await readPackageJson(tempDir);
  const resolved = await resolvePackageManager(tempDir, packageJson);
  expect(resolved).toBe("pnpm");
});

test("buildRunCommand builds argv for each package manager", () => {
  expect(buildRunCommand("bun", "dev")).toEqual(["bun", "run", "dev"]);
  expect(buildRunCommand("bun", "dev", "-- --watch")).toEqual(["bun", "run", "dev", "--", "--watch"]);
  expect(buildRunCommand("bun", "publish", "root@xxx")).toEqual(["bun", "run", "publish", "root@xxx"]);
  expect(buildRunCommand("pnpm", "test")).toEqual(["pnpm", "run", "test"]);
  expect(buildRunCommand("pnpm", "test", "-- --coverage")).toEqual([
    "pnpm",
    "run",
    "test",
    "--",
    "--coverage",
  ]);
  expect(buildRunCommand("yarn", "lint")).toEqual(["yarn", "run", "lint"]);
  expect(buildRunCommand("npm", "start")).toEqual(["npm", "run", "start"]);
});

test("formatRunCommand joins argv into a shell command", () => {
  expect(formatRunCommand("pnpm", "test", "-- --coverage")).toBe("pnpm run test -- --coverage");
  expect(formatRunCommand("npm", "start")).toBe("npm run start");
});

test("preparePackageScriptRun rejects unknown script names", async () => {
  await fs.writeFile(
    path.join(tempDir, "package.json"),
    JSON.stringify({ scripts: { build: "echo build" } }),
    "utf8",
  );

  await expect(preparePackageScriptRun({ workspacePath: tempDir, script: "missing" })).rejects.toThrow(
    "Unknown script: missing",
  );
});

test("runPreparedPackageScriptInTerminal spawns shell and writes command", () => {
  const writes: Array<{ sessionId: string; data: string }> = [];
  const manager = {
    spawn: () => ({ sessionId: "session_1" }),
    write: (sessionId: string, data: string) => {
      writes.push({ sessionId, data });
    },
  } as unknown as InteractiveTerminalManager;

  const result = runPreparedPackageScriptInTerminal(manager, {
    workspacePath: tempDir,
    script: "dev",
    command: ["bun", "run", "dev"],
  });

  expect(result.sessionId).toBe("session_1");
  expect(result.script).toBe("dev");
  expect(result.command[1]).toBe("run");
  expect(result.command[2]).toBe("dev");
  expect(writes).toHaveLength(1);
  expect(writes[0]?.sessionId).toBe("session_1");
  expect(writes[0]?.data.endsWith("run dev\r")).toBe(true);
});

test("runPreparedPackageScriptAsBackgroundTask registers task metadata", () => {
  const calls: Array<{ workspacePath: string; command: string[]; label?: string; threadId?: string }> = [];
  const registry = {
    start: (request: { workspacePath: string; command: string[]; label?: string; threadId?: string }) => {
      calls.push(request);
      return {
        taskId: "task_1",
        sessionId: "session_1",
        workspacePath: request.workspacePath,
        command: request.command,
        label: request.label ?? "dev",
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
      };
    },
  } as unknown as BackgroundTerminalTaskRegistry;

  const result = runPreparedPackageScriptAsBackgroundTask(
    registry,
    {
      workspacePath: tempDir,
      script: "dev",
      command: ["bun", "run", "dev"],
    },
    { threadId: "thr_1" },
  );

  expect(result.taskId).toBe("task_1");
  expect(result.sessionId).toBe("session_1");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.label).toBe("脚本 dev");
  expect(calls[0]?.threadId).toBe("thr_1");
  expect(calls[0]?.command.at(-2)).toBe("run");
  expect(calls[0]?.command.at(-1)).toBe("dev");
});
