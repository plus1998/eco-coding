import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PackageScriptRunTarget } from "../shared/ipc";
import {
  buildLinuxOneLineCommand,
  buildMacITermOneLineCommand,
  buildMacTerminalScriptContent,
  buildWindowsCmdLine,
  shellQuote,
} from "../shared/shell-command";

export type ExternalTerminalTarget = Extract<PackageScriptRunTarget, "terminal" | "iterm">;

export interface ExternalTerminalLaunchInput {
  command: readonly string[];
  cwd: string;
  pathValue: string;
}

export interface ExternalTerminalLaunchResult {
  launcherName: string;
}

interface LinuxTerminalLauncher {
  name: string;
  argv: (innerCommand: string) => string[];
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function commandExists(name: string): boolean {
  try {
    const checker = process.platform === "win32" ? "where" : "which";
    execFileSync(checker, [name], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function resolveLinuxTerminalLauncher(
  exists: (name: string) => boolean = commandExists,
): LinuxTerminalLauncher | undefined {
  const launchers: LinuxTerminalLauncher[] = [
    {
      name: "gnome-terminal",
      argv: (innerCommand) => ["--", "bash", "--noprofile", "--norc", "-c", innerCommand],
    },
    {
      name: "konsole",
      argv: (innerCommand) => ["--separate", "-e", "bash", "--noprofile", "--norc", "-c", innerCommand],
    },
    {
      name: "xfce4-terminal",
      argv: (innerCommand) => [
        "--command",
        `bash --noprofile --norc -c ${shellQuote(innerCommand)}`,
      ],
    },
    {
      name: "alacritty",
      argv: (innerCommand) => ["-e", "bash", "--noprofile", "--norc", "-c", innerCommand],
    },
    {
      name: "kitty",
      argv: (innerCommand) => ["bash", "--noprofile", "--norc", "-c", innerCommand],
    },
    {
      name: "xterm",
      argv: (innerCommand) => ["-e", "bash", "--noprofile", "--norc", "-c", innerCommand],
    },
  ];

  return launchers.find((launcher) => exists(launcher.name));
}

export function buildITermOsascriptArgs(oneLineCommand: string): string[] {
  const escaped = escapeAppleScriptString(oneLineCommand);
  const scriptLines = [
    'tell application "iTerm"',
    `create window with default profile command "${escaped}"`,
    "activate",
    "end tell",
  ];
  return scriptLines.flatMap((line) => ["-e", line]);
}

function spawnDetached(executable: string, args: string[]): void {
  const child = spawn(executable, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function launchOnMac(
  target: ExternalTerminalTarget,
  input: ExternalTerminalLaunchInput,
): ExternalTerminalLaunchResult {
  if (target === "iterm") {
    const oneLineCommand = buildMacITermOneLineCommand(input.command, input.cwd, input.pathValue);
    execFileSync("osascript", buildITermOsascriptArgs(oneLineCommand), { stdio: "pipe" });
    return { launcherName: "iTerm2" };
  }

  const scriptPath = path.join(tmpdir(), `eco-package-script-${randomUUID()}.command`);
  writeFileSync(
    scriptPath,
    buildMacTerminalScriptContent(input.command, input.cwd, input.pathValue),
    { mode: 0o755 },
  );
  execFileSync("open", ["-a", "Terminal", scriptPath], { stdio: "pipe" });
  return { launcherName: "Terminal" };
}

function launchOnLinux(input: ExternalTerminalLaunchInput): ExternalTerminalLaunchResult {
  const launcher = resolveLinuxTerminalLauncher();
  if (!launcher) {
    throw new Error("未找到可用的终端程序（gnome-terminal、konsole、xfce4-terminal 等）。");
  }
  const innerCommand = buildLinuxOneLineCommand(input.command, input.cwd, input.pathValue);
  spawnDetached(launcher.name, launcher.argv(innerCommand));
  return { launcherName: launcher.name };
}

function resolveWindowsTerminalExecutable(): string | undefined {
  const localAppData = process.env.LOCALAPPDATA;
  const candidates = [
    localAppData ? path.join(localAppData, "Microsoft", "Windows Apps", "wt.exe") : "",
    localAppData ? path.join(localAppData, "Microsoft", "WindowsApps", "wt.exe") : "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return commandExists("wt") ? "wt" : undefined;
}

function launchOnWindows(input: ExternalTerminalLaunchInput): ExternalTerminalLaunchResult {
  const cmdLine = buildWindowsCmdLine(input.command, input.cwd, input.pathValue);
  const windowsTerminal = resolveWindowsTerminalExecutable();
  if (windowsTerminal) {
    spawnDetached(windowsTerminal, ["-w", "0", "new-tab", "-d", input.cwd, "cmd", "/k", cmdLine]);
    return { launcherName: "Windows Terminal" };
  }

  spawnDetached("cmd.exe", ["/c", "start", "", "cmd.exe", "/k", cmdLine]);
  return { launcherName: "命令提示符" };
}

export function launchInExternalTerminal(
  target: ExternalTerminalTarget,
  input: ExternalTerminalLaunchInput,
): ExternalTerminalLaunchResult {
  try {
    if (process.platform === "darwin") {
      return launchOnMac(target, input);
    }
    if (process.platform === "linux") {
      if (target === "iterm") {
        throw new Error("iTerm 仅支持 macOS。");
      }
      return launchOnLinux(input);
    }
    if (process.platform === "win32") {
      if (target === "iterm") {
        throw new Error("iTerm 仅支持 macOS。");
      }
      return launchOnWindows(input);
    }
    throw new Error(`当前平台 (${process.platform}) 暂不支持外部终端。`);
  } catch (error) {
    if (error instanceof Error) {
      const message = error.message;
      if (
        message.startsWith("未找到") ||
        message.startsWith("iTerm") ||
        message.startsWith("当前平台") ||
        message.startsWith("无法在外部终端")
      ) {
        throw error;
      }
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`无法在外部终端中启动：${detail}`);
  }
}
