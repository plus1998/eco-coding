import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { IPty } from "node-pty";
import * as pty from "node-pty";
import type { PackageScriptStreamEvent } from "../shared/ipc";
import { resolveCommandExecutable, toSpawnEnv } from "./resolve-command-executable";

export type PackageScriptEventEmitter = (event: PackageScriptStreamEvent) => void;

interface ActivePackageScriptRun {
  runId: string;
  script: string;
  command: string[];
  pty: IPty;
}

const PTY_OPTIONS = {
  name: "xterm-256color",
  cols: 120,
  rows: 30,
} as const;

export class PackageScriptRunner {
  private readonly runs = new Map<string, ActivePackageScriptRun>();

  constructor(private readonly emit: PackageScriptEventEmitter) {}

  start(
    command: string[],
    cwd: string,
    script: string,
  ): { runId: string; command: string[]; script: string } {
    const executableName = command[0];
    if (!executableName) {
      throw new Error("Missing executable.");
    }
    if (!existsSync(cwd)) {
      throw new Error(`Workspace directory does not exist: ${cwd}`);
    }

    const runId = randomUUID();
    const resolvedCommand = [resolveCommandExecutable(executableName), ...command.slice(1)];
    const [executable, ...args] = resolvedCommand;
    if (!executable) {
      throw new Error("Missing executable.");
    }
    if (executable.includes("/") && !existsSync(executable)) {
      throw new Error(`Executable not found: ${executable}`);
    }

    const env = toSpawnEnv();
    let ptyProcess: IPty;
    try {
      ptyProcess = pty.spawn(executable, args, {
        ...PTY_OPTIONS,
        cwd,
        env,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to start package script (${resolvedCommand.join(" ")}): ${detail}. Ensure ${executableName} is installed and available in PATH.`,
      );
    }

    this.runs.set(runId, { runId, script, command: resolvedCommand, pty: ptyProcess });

    ptyProcess.onData((data) => {
      this.emit({ type: "output", runId, data });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      this.runs.delete(runId);
      this.emit({
        type: "exit",
        runId,
        exitCode: exitCode ?? 1,
        ...(signal !== undefined && { signal }),
      });
    });

    return { runId, command: resolvedCommand, script };
  }

  stop(runId: string): boolean {
    const active = this.runs.get(runId);
    if (!active) {
      return false;
    }
    active.pty.kill();
    this.runs.delete(runId);
    return true;
  }
}
