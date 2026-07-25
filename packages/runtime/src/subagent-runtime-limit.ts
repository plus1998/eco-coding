import type { EcoSubagentRuntimeLimitHooks } from "./eco-hook-context.js";

export const DEFAULT_SUBAGENT_MAX_RUNTIME_MS = 30 * 60 * 1_000;

type TimerHandle = ReturnType<typeof setTimeout>;

export interface SubagentRuntimeLimitControllerOptions {
  maxRuntimeMs?: number;
  stopTask: (agentId: string) => Promise<void> | void;
  onTimeout?: (input: { agentId: string; maxRuntimeMs: number }) => void;
  onStopError?: (input: { agentId: string; error: unknown }) => void;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  cancel?: (timer: TimerHandle) => void;
}

export class SubagentRuntimeLimitController implements EcoSubagentRuntimeLimitHooks {
  private readonly timers = new Map<string, TimerHandle>();
  private readonly maxRuntimeMs: number;

  constructor(private readonly options: SubagentRuntimeLimitControllerOptions) {
    this.maxRuntimeMs = positiveDuration(options.maxRuntimeMs, DEFAULT_SUBAGENT_MAX_RUNTIME_MS);
  }

  onStart(input: { agentId: string }): void {
    const agentId = input.agentId.trim();
    if (!agentId) return;

    this.onStop({ agentId });
    const timer = (this.options.schedule ?? setTimeout)(() => {
      this.timers.delete(agentId);
      void Promise.resolve()
        .then(() => this.options.stopTask(agentId))
        .then(() => this.options.onTimeout?.({ agentId, maxRuntimeMs: this.maxRuntimeMs }))
        .catch((error) => this.options.onStopError?.({ agentId, error }));
    }, this.maxRuntimeMs);
    timer.unref?.();
    this.timers.set(agentId, timer);
  }

  onStop(input: { agentId: string }): void {
    const agentId = input.agentId.trim();
    if (!agentId) return;
    const timer = this.timers.get(agentId);
    if (!timer) return;
    (this.options.cancel ?? clearTimeout)(timer);
    this.timers.delete(agentId);
  }

  clear(): void {
    for (const timer of this.timers.values()) {
      (this.options.cancel ?? clearTimeout)(timer);
    }
    this.timers.clear();
  }
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : fallback;
}
