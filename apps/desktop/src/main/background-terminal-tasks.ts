import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  BackgroundTerminalListRequest,
  BackgroundTerminalStartRequest,
  BackgroundTerminalStopResult,
  BackgroundTerminalTask,
  TerminalStreamEvent,
} from "../shared/ipc";
import type { InteractiveTerminalManager } from "./interactive-terminal-manager";
import { buildShellCommandLine, resolveCommandExecutable } from "./resolve-command-executable";

function nowIso(): string {
  return new Date().toISOString();
}

const MAX_CAPTURED_OUTPUT_LENGTH = 128 * 1024;

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveDisplayLabel(input: BackgroundTerminalStartRequest): string {
  const explicit = normalizeOptionalText(input.label);
  if (explicit) {
    return explicit;
  }
  return buildShellCommandLine(input.command);
}

function resolveCommand(command: readonly string[]): string[] {
  const executable = command[0]?.trim();
  if (!executable) {
    throw new Error("Background terminal command is required.");
  }
  return [resolveCommandExecutable(executable), ...command.slice(1)];
}

function toTaskSummary(task: BackgroundTerminalTask): BackgroundTerminalTask {
  const summary = { ...task };
  delete summary.output;
  delete summary.outputTruncated;
  return summary;
}

export class BackgroundTerminalTaskRegistry {
  private readonly tasks = new Map<string, BackgroundTerminalTask>();

  constructor(private readonly terminalManager: InteractiveTerminalManager) {}

  start(request: BackgroundTerminalStartRequest): BackgroundTerminalTask {
    const workspacePath = path.resolve(request.workspacePath.trim());
    const command = resolveCommand(request.command);
    const { sessionId } = this.terminalManager.spawn(workspacePath);
    const threadId = normalizeOptionalText(request.threadId);
    const task: BackgroundTerminalTask = {
      taskId: randomUUID(),
      workspacePath,
      command,
      label: resolveDisplayLabel({ ...request, command }),
      sessionId,
      status: "running",
      startedAt: nowIso(),
      ...(threadId && { threadId }),
    };
    this.tasks.set(task.taskId, task);
    this.terminalManager.write(sessionId, `${buildShellCommandLine(command)}\r`);
    return { ...task };
  }

  list(request: BackgroundTerminalListRequest = {}): BackgroundTerminalTask[] {
    const workspacePath = normalizeOptionalText(request.workspacePath);
    const resolvedWorkspacePath = workspacePath ? path.resolve(workspacePath) : undefined;
    const threadId = normalizeOptionalText(request.threadId);
    return [...this.tasks.values()]
      .filter((task) => !resolvedWorkspacePath || task.workspacePath === resolvedWorkspacePath)
      .filter((task) => !threadId || task.threadId === threadId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map(toTaskSummary);
  }

  get(taskId: string): BackgroundTerminalTask | undefined {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : undefined;
  }

  stop(taskId: string): BackgroundTerminalStopResult {
    const current = this.tasks.get(taskId);
    if (!current) {
      return { stopped: false };
    }
    const killed = this.terminalManager.kill(current.sessionId);
    const next: BackgroundTerminalTask = {
      ...current,
      status: "stopped",
      endedAt: current.endedAt ?? nowIso(),
    };
    this.tasks.set(taskId, next);
    return { stopped: killed, task: { ...next } };
  }

  handleTerminalEvent(event: TerminalStreamEvent): void {
    const match = [...this.tasks.values()].find((task) => task.sessionId === event.sessionId);
    if (!match) {
      return;
    }

    if (event.type === "output") {
      const combined = `${match.output ?? ""}${event.data}`;
      const outputTruncated = combined.length > MAX_CAPTURED_OUTPUT_LENGTH;
      this.tasks.set(match.taskId, {
        ...match,
        output: outputTruncated ? combined.slice(-MAX_CAPTURED_OUTPUT_LENGTH) : combined,
        ...(outputTruncated || match.outputTruncated ? { outputTruncated: true } : {}),
      });
      return;
    }

    if ((event.type !== "exit" && event.type !== "error") || match.status === "stopped") {
      return;
    }
    const next: BackgroundTerminalTask =
      event.type === "exit"
        ? {
            ...match,
            status: event.exitCode === 0 ? "exited" : "failed",
            exitCode: event.exitCode,
            ...(event.signal !== undefined && { signal: event.signal }),
            endedAt: nowIso(),
          }
        : {
            ...match,
            status: "failed",
            endedAt: nowIso(),
          };
    this.tasks.set(next.taskId, next);
  }
}
