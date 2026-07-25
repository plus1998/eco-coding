type TimerHandle = ReturnType<typeof setTimeout>;

export interface CodexSubagentRuntimeLimitInput {
  threadId: string;
  agentId: string;
  turnId: string;
}

export interface CodexSubagentRuntimeLimitControllerOptions {
  maxRuntimeMs: number;
  interruptTurn: (input: CodexSubagentRuntimeLimitInput) => Promise<void> | void;
  onTimeout?: (input: CodexSubagentRuntimeLimitInput & { maxRuntimeMs: number }) => void;
  onInterruptError?: (input: CodexSubagentRuntimeLimitInput & { error: unknown }) => void;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  cancel?: (timer: TimerHandle) => void;
}

interface ActiveLimit extends CodexSubagentRuntimeLimitInput {
  timer: TimerHandle;
}

export class CodexSubagentRuntimeLimitController {
  private readonly active = new Map<string, ActiveLimit>();

  constructor(private readonly options: CodexSubagentRuntimeLimitControllerOptions) {}

  start(input: CodexSubagentRuntimeLimitInput): void {
    const normalized = normalizeInput(input);
    if (!normalized) return;
    this.stop(normalized.agentId);

    const timer = (this.options.schedule ?? setTimeout)(() => {
      const active = this.active.get(normalized.agentId);
      if (!active || active.turnId !== normalized.turnId) return;
      this.active.delete(normalized.agentId);
      void Promise.resolve()
        .then(() => this.options.interruptTurn(normalized))
        .then(() => this.options.onTimeout?.({ ...normalized, maxRuntimeMs: this.options.maxRuntimeMs }))
        .catch((error) => this.options.onInterruptError?.({ ...normalized, error }));
    }, this.options.maxRuntimeMs);
    timer.unref?.();
    this.active.set(normalized.agentId, { ...normalized, timer });
  }

  stop(agentId: string): void {
    const normalized = agentId.trim();
    if (!normalized) return;
    const active = this.active.get(normalized);
    if (!active) return;
    (this.options.cancel ?? clearTimeout)(active.timer);
    this.active.delete(normalized);
  }

  clear(): void {
    for (const active of this.active.values()) {
      (this.options.cancel ?? clearTimeout)(active.timer);
    }
    this.active.clear();
  }
}

function normalizeInput(input: CodexSubagentRuntimeLimitInput): CodexSubagentRuntimeLimitInput | undefined {
  const threadId = input.threadId.trim();
  const agentId = input.agentId.trim();
  const turnId = input.turnId.trim();
  return threadId && agentId && turnId ? { threadId, agentId, turnId } : undefined;
}
