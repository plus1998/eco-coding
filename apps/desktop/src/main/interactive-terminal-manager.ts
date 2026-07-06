import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { IPty } from "node-pty";
import * as pty from "node-pty";
import type { TerminalSessionView, TerminalStreamEvent } from "../shared/ipc";
import { toSpawnEnv } from "./resolve-command-executable";

export type TerminalEventEmitter = (event: TerminalStreamEvent) => void;

interface ActiveTerminalSession {
  sessionId: string;
  workspacePath: string;
  pty: IPty;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;

function resolveInteractiveShell(): { executable: string; args: string[] } {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec?.trim();
    if (comspec) {
      return { executable: comspec, args: [] };
    }
    return { executable: "powershell.exe", args: [] };
  }

  const shell = process.env.SHELL?.trim() || "/bin/bash";
  const name = shell.split("/").pop() ?? "";
  if (name === "zsh" || name === "bash") {
    return { executable: shell, args: ["-l"] };
  }
  return { executable: shell, args: [] };
}

export class InteractiveTerminalManager {
  private readonly sessions = new Map<string, ActiveTerminalSession>();

  constructor(private readonly emit: TerminalEventEmitter) {}

  spawn(workspacePath: string, size?: { cols: number; rows: number }): { sessionId: string } {
    const cwd = workspacePath.trim();
    if (!cwd) {
      throw new Error("Workspace path is required.");
    }
    if (!existsSync(cwd)) {
      throw new Error(`Workspace directory does not exist: ${cwd}`);
    }

    const sessionId = randomUUID();
    const { executable, args } = resolveInteractiveShell();
    const cols = size?.cols ?? DEFAULT_COLS;
    const rows = size?.rows ?? DEFAULT_ROWS;
    const env = toSpawnEnv();

    let ptyProcess: IPty;
    try {
      ptyProcess = pty.spawn(executable, args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to start interactive terminal: ${detail}`);
    }

    this.sessions.set(sessionId, { sessionId, workspacePath: cwd, pty: ptyProcess });
    this.emit({ type: "started", sessionId, workspacePath: cwd });

    ptyProcess.onData((data) => {
      if (!this.sessions.has(sessionId)) {
        return;
      }
      this.emit({ type: "output", sessionId, data });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      if (!this.sessions.has(sessionId)) {
        return;
      }
      this.sessions.delete(sessionId);
      this.emit({
        type: "exit",
        sessionId,
        exitCode: exitCode ?? 1,
        ...(signal !== undefined && { signal }),
      });
    });

    return { sessionId };
  }

  write(sessionId: string, data: string): void {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }
    session.pty.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.getSession(sessionId);
    if (!session) {
      return;
    }
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) {
      return;
    }
    session.pty.resize(Math.floor(cols), Math.floor(rows));
  }

  kill(sessionId: string): boolean {
    const session = this.getSession(sessionId);
    if (!session) {
      return false;
    }
    session.pty.kill();
    this.sessions.delete(sessionId);
    return true;
  }

  get(sessionId: string): ActiveTerminalSession | undefined {
    return this.getSession(sessionId);
  }

  list(workspacePath?: string): TerminalSessionView[] {
    const normalizedWorkspacePath = workspacePath?.trim();
    return [...this.sessions.values()]
      .filter((session) => !normalizedWorkspacePath || session.workspacePath === normalizedWorkspacePath)
      .map((session) => ({
        sessionId: session.sessionId,
        workspacePath: session.workspacePath,
      }));
  }

  private getSession(sessionId: string): ActiveTerminalSession | undefined {
    return this.sessions.get(sessionId);
  }
}
