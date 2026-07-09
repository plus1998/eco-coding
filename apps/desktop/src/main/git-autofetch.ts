import {
  DEFAULT_GIT_AUTOFETCH_PERIOD_SECONDS,
  fetchFromOrigin,
  type GitRunner,
} from "./git-operations";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GitAutoFetcherOptions {
  run: GitRunner;
  onFetched?: (workspacePath: string) => void;
  isGitBusy?: () => boolean;
}

export class GitAutoFetcher {
  private workspacePath: string | undefined;
  private autofetchEnabled = true;
  private periodMs = DEFAULT_GIT_AUTOFETCH_PERIOD_SECONDS * 1000;
  private windowFocused = true;
  private running = false;
  private loopGeneration = 0;

  constructor(private readonly options: GitAutoFetcherOptions) {}

  configure(input: { enabled?: boolean; periodSeconds?: number }): void {
    if (input.enabled !== undefined) {
      this.autofetchEnabled = input.enabled;
    }
    if (input.periodSeconds !== undefined) {
      this.periodMs = Math.max(30, input.periodSeconds) * 1000;
    }
    this.restartLoop();
  }

  setWorkspace(workspacePath: string | undefined): void {
    const next = workspacePath?.trim() || undefined;
    if (next === this.workspacePath) {
      return;
    }
    this.workspacePath = next;
    this.restartLoop();
  }

  setWindowFocused(focused: boolean): void {
    if (focused === this.windowFocused) {
      return;
    }
    this.windowFocused = focused;
    if (focused) {
      this.restartLoop();
    }
  }

  dispose(): void {
    this.loopGeneration += 1;
    this.running = false;
    this.workspacePath = undefined;
  }

  private restartLoop(): void {
    this.loopGeneration += 1;
    if (this.autofetchEnabled && this.workspacePath && this.windowFocused) {
      void this.runLoop(this.loopGeneration);
    }
  }

  private async runLoop(generation: number): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      while (
        generation === this.loopGeneration &&
        this.autofetchEnabled &&
        this.workspacePath &&
        this.windowFocused
      ) {
        await this.waitUntilIdleAndFocused();
        if (generation !== this.loopGeneration) {
          break;
        }

        const workspacePath = this.workspacePath;
        if (!workspacePath) {
          break;
        }

        const result = await fetchFromOrigin(workspacePath, this.options.run);
        if (result.ok) {
          this.options.onFetched?.(workspacePath);
        }

        await sleep(this.periodMs);
      }
    } finally {
      if (generation === this.loopGeneration) {
        this.running = false;
      }
    }
  }

  private async waitUntilIdleAndFocused(): Promise<void> {
    while (this.workspacePath && this.windowFocused) {
      if (!this.options.isGitBusy?.()) {
        return;
      }
      await sleep(500);
    }
  }
}
