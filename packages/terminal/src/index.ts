import { createAgentEvent, type AgentEvent } from "../../shared/src";
import { evaluateCommand, type PolicyDecision } from "../../workspace/src";

export interface TerminalSpawnRequest {
  sessionId: string;
  threadId: string;
  agentId: string;
  command: string[];
  cwd: string;
  workspacePath: string;
  env?: Record<string, string>;
}

export interface TerminalProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (exitCode: number, signal?: string) => void): void;
}

export interface TerminalSpawner {
  spawn(request: TerminalSpawnRequest): TerminalProcess;
}

export type TerminalStartResult =
  | { ok: true; session: ManagedTerminalSession }
  | { ok: false; decision: PolicyDecision };

export class ManagedTerminalSession {
  constructor(
    readonly request: TerminalSpawnRequest,
    private readonly process: TerminalProcess,
  ) {}

  write(data: string): void {
    this.process.write(data);
  }

  resize(cols: number, rows: number): void {
    this.process.resize(cols, rows);
  }

  kill(signal = "SIGTERM"): void {
    this.process.kill(signal);
  }
}

export class TerminalSessionManager {
  private readonly sessions = new Map<string, ManagedTerminalSession>();

  constructor(
    private readonly spawner: TerminalSpawner,
    private readonly emit: (event: AgentEvent) => void,
  ) {}

  start(request: TerminalSpawnRequest): TerminalStartResult {
    const decision = evaluateCommand({
      command: request.command,
      cwd: request.cwd,
      workspacePath: request.workspacePath,
    });

    if (decision.action !== "allow") {
      return { ok: false, decision };
    }

    const process = this.spawner.spawn(request);
    const session = new ManagedTerminalSession(request, process);
    this.sessions.set(request.sessionId, session);

    process.onData((data) => {
      this.emit(createTerminalOutputEvent(request, data));
    });

    process.onExit((exitCode, signal) => {
      this.emit(createAgentEvent({
        id: `${request.sessionId}:terminal-exit:${Date.now()}`,
        threadId: request.threadId,
        agentId: request.agentId,
        role: "tester",
        type: "tool.completed",
        payload: { terminalSessionId: request.sessionId, exitCode, signal },
      }));
      this.sessions.delete(request.sessionId);
    });

    return { ok: true, session };
  }

  get(sessionId: string): ManagedTerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  stop(sessionId: string): void {
    this.sessions.get(sessionId)?.kill();
    this.sessions.delete(sessionId);
  }
}

export function createTerminalOutputEvent(request: TerminalSpawnRequest, data: string): AgentEvent {
  return createAgentEvent({
    id: `${request.sessionId}:terminal-output:${Date.now()}`,
    threadId: request.threadId,
    agentId: request.agentId,
    role: "tester",
    type: "terminal.output",
    payload: {
      terminalSessionId: request.sessionId,
      command: request.command,
      data,
    },
  });
}
