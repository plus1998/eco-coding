import { type ClaudeQueryHandle, isClaudeStreamInputDeliveryUnknown } from "@eco/runtime/sdk";

export type ClaudeMidTurnPortPhase = "accepting" | "closing" | "closed";

export type ClaudeMidTurnPushResult =
  | { ok: true }
  | { ok: false; reason: string; retriable: boolean; deliveryUnknown: boolean };

type PortEntry = {
  threadId: string;
  phase: ClaudeMidTurnPortPhase;
  handle: ClaudeQueryHandle;
  inflight: Set<Promise<unknown>>;
};

/**
 * Main-process registry for live Claude Query mid-turn inject.
 * One open port per thread; product push only when phase === accepting.
 */
export class ClaudeMidTurnPortRegistry {
  private readonly ports = new Map<string, PortEntry>();

  open(threadId: string, handle: ClaudeQueryHandle): void {
    const id = threadId.trim();
    if (!id) {
      return;
    }
    this.ports.set(id, {
      threadId: id,
      phase: "accepting",
      handle,
      inflight: new Set(),
    });
  }

  getPhase(threadId: string): ClaudeMidTurnPortPhase | undefined {
    return this.ports.get(threadId.trim())?.phase;
  }

  isAccepting(threadId: string): boolean {
    return this.getPhase(threadId) === "accepting";
  }

  /**
   * Stop accepting new push; wait for in-flight streamInput work so teardown
   * does not race a successful mid-turn inject.
   */
  async closeIngress(threadId: string): Promise<void> {
    const port = this.ports.get(threadId.trim());
    if (!port || port.phase === "closed") {
      return;
    }
    port.phase = "closing";
    if (port.inflight.size === 0) {
      return;
    }
    await Promise.allSettled([...port.inflight]);
  }

  close(threadId: string): void {
    const id = threadId.trim();
    const port = this.ports.get(id);
    if (!port) {
      return;
    }
    port.phase = "closed";
    this.ports.delete(id);
  }

  async tryPushUserText(
    threadId: string,
    text: string,
    options?: { uuid?: string },
  ): Promise<ClaudeMidTurnPushResult> {
    const port = this.ports.get(threadId.trim());
    if (!port || port.phase !== "accepting") {
      return {
        ok: false,
        reason: "No live Claude query is accepting mid-turn input.",
        retriable: true,
        deliveryUnknown: false,
      };
    }
    const work = port.handle.pushUserMessage(text, options).then(
      () => ({ ok: true as const }),
      (error: unknown) => {
        const deliveryUnknown = isClaudeStreamInputDeliveryUnknown(error);
        const reason = error instanceof Error ? error.message : String(error);
        return {
          ok: false as const,
          reason,
          retriable: !deliveryUnknown && !/not accepting mid-turn|not available/i.test(reason),
          deliveryUnknown,
        };
      },
    );
    port.inflight.add(work);
    try {
      return await work;
    } finally {
      port.inflight.delete(work);
    }
  }
}
