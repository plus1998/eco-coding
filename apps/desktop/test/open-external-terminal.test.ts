import { expect, test } from "bun:test";
import { resolveLinuxTerminalLauncher } from "../src/main/open-external-terminal";

test("resolveLinuxTerminalLauncher prefers gnome-terminal when available", () => {
  const launcher = resolveLinuxTerminalLauncher((name) => name === "gnome-terminal");
  expect(launcher?.name).toBe("gnome-terminal");
  expect(launcher?.argv("cd /tmp && bun run dev")).toEqual([
    "--",
    "bash",
    "--noprofile",
    "--norc",
    "-c",
    "cd /tmp && bun run dev",
  ]);
});

test("resolveLinuxTerminalLauncher falls back to later candidates", () => {
  const launcher = resolveLinuxTerminalLauncher((name) => name === "xterm");
  expect(launcher?.name).toBe("xterm");
});
